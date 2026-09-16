// Companion utilities: hidden analysis process and fixed source-canvas bounds.
(function () {
    function temporaryFile(extension) {
        return new File(Folder.temp.fsName + "/SequenceLayout_" + new Date().getTime() +
            "_" + Math.floor(Math.random() * 1000000000) + extension);
    }

    function readText(file) {
        if (!file || !file.exists) return "";
        file.encoding = "UTF-8";
        if (!file.open("r")) return "";
        var text = file.read().replace(/^\uFEFF/, "");
        file.close();
        return text;
    }

    function fingerprint(comp) {
        var data = [comp.id, comp.width, comp.height, comp.numLayers];
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var t = layer.property("ADBE Transform Group");
            data.push(layer.id, layer.source ? layer.source.id : 0, layer.parent ? layer.parent.id : 0,
                layer.threeDLayer, layer.locked, layer.enabled);
            if (t) {
                var names = ["ADBE Position", "ADBE Anchor Point", "ADBE Scale", "ADBE Rotate Z"];
                for (var j = 0; j < names.length; j++) {
                    var p = t.property(names[j]);
                    if (p) data.push(String(p.value), p.numKeys, p.expressionEnabled);
                }
            }
        }
        return data.join("|");
    }

    function runHiddenAsync(command, options, onComplete, onError) {
        var launcher = temporaryFile(".vbs"), doneFile = temporaryFile(".done");
        var id = "job_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000000000);
        if (!$.global.__SequenceLayoutJobs) $.global.__SequenceLayoutJobs = {};
        var jobs = $.global.__SequenceLayoutJobs;
        var started = new Date().getTime(), receivedProgress = false;
        function cleanup() {
            delete jobs[id];
            var files = [launcher, doneFile, options.progressFile];
            for (var i = 0; i < files.length; i++) {
                if (files[i]) { try { files[i].remove(); } catch (e) {} }
            }
        }
        function fail(error) {
            cleanup();
            onError(error);
        }
        function schedule() {
            app.scheduleTask("$.global.__SequenceLayoutJobs['" + id + "'].poll();", 250, false);
        }
        try {
            launcher.encoding = "UTF-16";
            if (!launcher.open("w")) throw new Error("Cannot create background launcher.");
            launcher.write('On Error Resume Next\r\nSet shell = CreateObject("WScript.Shell")\r\n' +
                'result = shell.Run("' + command.replace(/"/g, '""') + '", 0, True)\r\n' +
                'launchError = Err.Number\r\nErr.Clear\r\nSet fso = CreateObject("Scripting.FileSystemObject")\r\n' +
                'Set marker = fso.CreateTextFile("' + doneFile.fsName.replace(/"/g, '""') + '", True)\r\n' +
                'marker.Write CStr(result) & "|" & CStr(launchError)\r\nmarker.Close\r\n');
            launcher.close();
            jobs[id] = {poll: function() {
                try {
                    var elapsed = Math.floor((new Date().getTime() - started) / 1000);
                    var fields = readText(options.progressFile).split("|");
                    if (fields.length >= 2) {
                        var completed = parseInt(fields[0], 10), total = parseInt(fields[1], 10);
                        if (isFinite(completed) && total > 0) {
                            receivedProgress = true;
                            if (options.onProgress)
                                options.onProgress(completed, total, elapsed);
                        }
                    }
                    var done = readText(doneFile);
                    if (done) {
                        var codes = done.split("|");
                        if (parseInt(codes[0], 10) !== 0 || parseInt(codes[1], 10) !== 0)
                            throw new Error("Background analysis failed (exit " + done + ").");
                        cleanup();
                        onComplete();
                        return;
                    }
                    if (elapsed > 1800 || (!receivedProgress && elapsed > 120))
                        throw new Error("Background analysis timed out.");
                    // One short callback per tick. No loops or sleep keep AE occupied.
                    schedule();
                } catch (error) { fail(error); }
            }};
            // Shell association dispatches asynchronously; no synchronous command pipe
            // remains attached to the long-running worker.
            if (!launcher.execute()) throw new Error("无法启动后台分析，请检查 Windows 的 VBS 脚本关联。");
            schedule();
        } catch (error) { fail(error); }
    }

    function pointToComp(layer, point) {
        var t = layer.property("ADBE Transform Group");
        var a = t.property("ADBE Anchor Point").value;
        var s = t.property("ADBE Scale").value;
        var p = t.property("ADBE Position").value;
        var r = t.property("ADBE Rotate Z").value * Math.PI / 180;
        var x = (point[0] - a[0]) * s[0] / 100;
        var y = (point[1] - a[1]) * s[1] / 100;
        return [p[0] + x * Math.cos(r) - y * Math.sin(r),
            p[1] + x * Math.sin(r) + y * Math.cos(r)];
    }

    function fit(comp, helper, encode, quote, onComplete, onError) {
        var entries = [];
        var positions = [];
        // Validate before changing dimensions. All layers must translate together.
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var t = layer.property("ADBE Transform Group");
            var p = t ? t.property("ADBE Position") : null;
            if (layer.threeDLayer || layer.parent || !p || p.numKeys > 0 || p.expressionEnabled)
                throw new Error("Auto-fit requires static, unparented 2D positions: " + layer.name);
            if (p.dimensionsSeparated) {
                var xp = p.getSeparationFollower(0);
                var yp = p.getSeparationFollower(1);
                if (xp.numKeys || yp.numKeys || xp.expressionEnabled || yp.expressionEnabled)
                    throw new Error("Auto-fit requires static positions: " + layer.name);
            }
            var staticTransforms = ["ADBE Anchor Point", "ADBE Scale", "ADBE Rotate Z"];
            for (var k = 0; k < staticTransforms.length; k++) {
                var prop = t.property(staticTransforms[k]);
                if (prop && (prop.numKeys > 0 || prop.expressionEnabled))
                    throw new Error("Auto-fit requires static anchor, scale and rotation: " + layer.name);
            }
            positions.push({layer: layer, value: p.value, locked: layer.locked});
            if (layer.nullLayer || layer.adjustmentLayer || !layer.hasVideo) continue;
            var source = layer.source;
            if (!source) throw new Error("Auto-fit cannot measure this layer: " + layer.name);
            // All frames share the source canvas. No PNG decoding is needed.
            var entry = {layer: layer, bounds: [0, 0, source.width, source.height]};
            entries.push(entry);
        }
        if (!entries.length) throw new Error("No image layers to fit.");

        var initialState = fingerprint(comp);
        function finish(text) {
            try {
                if (fingerprint(comp) !== initialState)
                    throw new Error("分析期间合成或图层发生变化，已取消自动适配。请重新运行。");
                var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i], b = entry.bounds;
                    if (b[2] <= 0 || b[3] <= 0) continue;
                    var corners = [[b[0], b[1]], [b[0] + b[2], b[1]],
                        [b[0], b[1] + b[3]], [b[0] + b[2], b[1] + b[3]]];
                    for (var j = 0; j < corners.length; j++) {
                        var point = pointToComp(entry.layer, corners[j]);
                        minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
                        maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
                    }
                }
                if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY))
                    throw new Error("No valid source dimensions found.");
                // One pixel of guard space protects antialiased edges after transforms.
                var left = Math.floor(minX) - 1, top = Math.floor(minY) - 1;
                var width = Math.max(4, Math.ceil(maxX) + 1 - left);
                var height = Math.max(4, Math.ceil(maxY) + 1 - top);
                if (width > 30000 || height > 30000) throw new Error("Content exceeds AE's 30000-pixel size limit.");
                app.beginUndoGroup("自动适配合成尺寸");
                try {
                comp.width = width;
                comp.height = height;
                for (var i = 0; i < positions.length; i++) {
                    var saved = positions[i];
                    try {
                        saved.layer.locked = false;
                        var p = saved.layer.property("ADBE Transform Group").property("ADBE Position");
                        if (p.dimensionsSeparated) {
                            p.getSeparationFollower(0).setValue(saved.value[0] - left);
                            p.getSeparationFollower(1).setValue(saved.value[1] - top);
                        } else p.setValue([saved.value[0] - left, saved.value[1] - top]);
                    } finally { saved.layer.locked = saved.locked; }
                }

                } finally { app.endUndoGroup(); }
                onComplete(width + " × " + height);
            } catch (error) { onError(error); }
        }
        finish("");
    }
    return {runHiddenAsync: runHiddenAsync, fit: fit, fingerprint: fingerprint};
})();

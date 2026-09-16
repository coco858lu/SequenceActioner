// Action switching and portable project presets. Shared by both language panels.
(function () {
    var markerPrefix = "[序列帧结束] ";
    function read(file) {
        file.encoding = "UTF-8";
        if (!file.open("r")) throw new Error("无法读取：" + file.fsName);
        try { return file.read().replace(/^\uFEFF/, ""); }
        finally { file.close(); }
    }
    function write(file, text) {
        file.encoding = "UTF-8";
        if (!file.open("w")) throw new Error("无法写入：" + file.fsName);
        try { file.write(text); } finally { file.close(); }
    }
    function dropdown(layer) {
        var effects = layer.property("ADBE Effect Parade"), found = null;
        if (effects) for (var i = 1; i <= effects.numProperties; i++) {
            if (effects.property(i).matchName === "ADBE Dropdown Control") {
                if (found) throw new Error("目标有多个下拉菜单，请保留一个动作菜单。");
                found = effects.property(i);
            }
        }
        if (!found) throw new Error("请先点击“确定”配置动作菜单。");
        return found;
    }
    function actions(layer) {
        var remap = layer.property("ADBE Time Remapping");
        if (!remap || !remap.expressionEnabled) throw new Error("目标尚未配置动作表达式，请先点击“确定”。");
        var text = remap.expression;
        var n = /var actionNames = \[([^\r\n]*)\];/.exec(text);
        var f = /var frameCounts = \[([^\r\n]*)\];/.exec(text);
        var l = /var loopSettings = \[([^\r\n]*)\];/.exec(text);
        if (!n || !f || !l) throw new Error("不能读取此图层的动作配置，请使用本脚本重新配置。");
        var names = [], match, re = /"((?:\\.|[^"\\])*)"/g;
        while ((match = re.exec(n[1])) !== null)
            names.push(match[1].replace(/\\(["\\nr])/g, function(all, c) {
                return c === "n" ? "\n" : c === "r" ? "\r" : c;
            }));
        var frames = f[1].split(","), loops = l[1].split(","), result = [];
        if (!names.length || frames.length !== names.length || loops.length !== names.length)
            throw new Error("动作配置不完整。");
        for (var i = 0; i < names.length; i++) {
            var count = Number(frames[i]);
            var loop = loops[i].replace(/\s/g, "");
            if (!isFinite(count) || count < 1 || count !== Math.floor(count) || !/^(true|false)$/.test(loop))
                throw new Error("动作帧数或循环设置无效。");
            result.push({name: names[i], frames: String(count), loop: loop === "true"});
        }
        return result;
    }
    function switchAction(comp, layer, index, rows) {
        var configured = actions(layer);
        if (index < 0 || index >= configured.length) throw new Error("动作不存在。");
        if (rows.length !== configured.length) throw new Error("列表已修改，请先点击“确定”或“更新”。");
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].name.replace(/^\s+|\s+$/g, "") !== configured[i].name ||
                    Number(rows[i].frames) !== Number(configured[i].frames) || rows[i].loop !== configured[i].loop)
                throw new Error("列表与已配置动作不同，请先点击“确定”或“更新”。");
        }
        var menu = dropdown(layer).property(1);
        if (layer.locked || menu.expressionEnabled) throw new Error("请解锁目标图层并关闭菜单表达式。");
        var time = comp.time;
        if (time < layer.inPoint || time >= layer.outPoint) throw new Error("当前时间不在目标图层范围内。");
        var action = configured[index], end = time + Number(action.frames) * comp.frameDuration;
        var markers = layer.property("ADBE Marker"), collision = false;
        // Preserve manually created markers, including those at the exact end time.
        if (!action.loop) for (var k = 1; k <= markers.numKeys; k++) {
            if (Math.abs(markers.keyTime(k) - end) < 0.00001 &&
                    markers.keyValue(k).comment.indexOf(markerPrefix) !== 0) collision = true;
        }
        app.beginUndoGroup("切换动作并标记结束");
        try {
            menu.setValueAtTime(time, index + 1);
            var key = menu.nearestKeyIndex(time);
            menu.setInterpolationTypeAtKey(key, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            for (var k = markers.numKeys; k >= 1; k--)
                if (markers.keyValue(k).comment.indexOf(markerPrefix) === 0) markers.removeKey(k);
            if (!action.loop && !collision) {
                var marker = new MarkerValue(markerPrefix + action.name + " · 播放结束");
                try { marker.label = 1; } catch (e) {}
                markers.setValueAtTime(end, marker);
            }
        } finally { app.endUndoGroup(); }
        return "已切换：" + action.name + (action.loop ? "（循环）" :
            " · 结束 " + end.toFixed(3) + " 秒" + (collision ? "（已有手动标记，未覆盖）" : "")) +
            (!action.loop && end >= Math.min(comp.duration, layer.outPoint) ? "\n结束点超出图层或合成范围，请延长时间轴。" : "");
    }
    function manifest(file) {
        var lines = read(file).split(/\r?\n/);
        if (lines[0] !== "SequenceActionerPreset|1") throw new Error("不是有效的序列帧预设。");
        var data = {rows: [], footage: []};
        for (var i = 1; i < lines.length; i++) {
            var p = lines[i].split("|");
            if (p[0] === "NAME") data.name = decodeURIComponent(p[1]);
            if (p[0] === "ROOT") data.token = p[1];
            if (p[0] === "FPS") data.fps = Number(p[1]);
            if (p[0] === "ACTION") data.rows.push({name: decodeURIComponent(p[1]), frames: p[2], loop: p[3] === "1"});
            if (p[0] === "MEDIA") data.footage.push({tag: p[1], path: decodeURIComponent(p[2]), sequence: p[3] === "1"});
        }
        if (!data.name || !/^SA_\d+_\d+$/.test(data.token) || !data.rows.length || data.rows.length > 20 || !(data.fps > 0))
            throw new Error("预设信息不完整。");
        return data;
    }
    function mediaFiles(item) {
        if (item.useProxy) throw new Error("预设暂不支持代理素材，请关闭代理：" + item.name);
        if (item.footageMissing) throw new Error("素材丢失：" + item.name);
        if (!item.file) return null; // Solids are embedded in the AE project.
        var file = item.file;
        if (!file.exists || item.footageMissing) throw new Error("素材丢失：" + file.fsName);
        var sequence = !item.mainSource.isStill && /\.(png|jpe?g|tiff?|tga|bmp|exr)$/i.test(file.name);
        if (!sequence) return {files: [file], sequence: false};
        var pattern = /^(.*?)(\d+)(\.[^.]+)$/.exec(file.name);
        if (!pattern) throw new Error("不能识别序列编号：" + file.name);
        var prefix = pattern[1], digits = pattern[2].length, ext = pattern[3];
        var start = Number(pattern[2]), count = Math.max(1, Math.round(item.duration / item.frameDuration));
        var files = [];
        for (var i = 0; i < count; i++) {
            var number = String(start + i);
            while (number.length < digits) number = "0" + number;
            var frame = new File(file.parent.fsName + "/" + prefix + number + ext);
            if (!frame.exists) throw new Error("缺少序列帧：" + frame.fsName);
            files.push(frame);
        }
        return {files: files, sequence: true};
    }
    function dependencies(comp, seen, result) {
        if (comp.useProxy) throw new Error("预设暂不支持合成代理，请关闭代理：" + comp.name);
        var key = "i" + comp.id;
        if (seen[key]) return;
        seen[key] = true;
        for (var i = 1; i <= comp.numLayers; i++) {
            var source = comp.layer(i).source;
            if (source instanceof CompItem) dependencies(source, seen, result);
            else if (source instanceof FootageItem && !seen["i" + source.id]) {
                seen["i" + source.id] = true;
                var media = mediaFiles(source);
                if (media) result.push({id: source.id, media: media});
            }
        }
    }
    function savePreset(folder, name, context, restored) {
        var comp = context.comp, layer = context.layer, rows = actions(layer), fps = comp.frameRate;
        if (!(layer.source instanceof CompItem)) throw new Error("请选择配置好的序列帧合成图层。");
        dropdown(layer);
        var assets = [];
        dependencies(layer.source, {}, assets);
        if (!confirm("保存预设需要先保存当前 AE 工程。\n随后在临时工程副本中打包素材，完成后恢复原工程。\n重新打开工程会清空撤销历史。\n是否继续？")) return false;
        if (!app.project.file) {
            if (!app.project.saveWithDialog()) return false;
        } else app.project.save();
        var original = new File(app.project.file.fsName);
        var token = "SA_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000000000);
        var pack = new Folder(folder.fsName + "/" + token);
        if (!pack.create()) throw new Error("无法创建预设目录。");
        var snapshot = new File(pack.fsName + "/working.aep");
        var project = new File(pack.fsName + "/project.aep");
        var wrapper = null, switched = false, finished = false;
        try {
            wrapper = app.project.items.addComp(name, comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
            wrapper.comment = token;
            layer.copyToComp(wrapper);
            switched = true;
            app.project.save(snapshot);
            if (!snapshot.exists) throw new Error("临时工程保存失败。");
            app.open(snapshot);
            if (!app.project.file || app.project.file.fsName !== snapshot.fsName)
                throw new Error("未打开临时工程，打包已停止。");
            var root = null;
            for (var i = 1; i <= app.project.numItems; i++)
                if (app.project.item(i) instanceof CompItem && app.project.item(i).comment === token) root = app.project.item(i);
            if (!root) throw new Error("不能找到预设合成。");
            app.project.reduceProject([root]);
            var lines = ["SequenceActionerPreset|1", "NAME|" + encodeURIComponent(name), "ROOT|" + token, "FPS|" + fps,
                "AE|" + encodeURIComponent(app.version)];
            for (var r = 0; r < rows.length; r++)
                lines.push("ACTION|" + encodeURIComponent(rows[r].name) + "|" + rows[r].frames + "|" + (rows[r].loop ? "1" : "0"));
            var copied = 0;
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (!(item instanceof FootageItem)) continue;
                var media = mediaFiles(item);
                if (!media) continue;
                var sub = new Folder(pack.fsName + "/media/" + item.id);
                var mediaRoot = new Folder(pack.fsName + "/media");
                if (!mediaRoot.exists && !mediaRoot.create()) throw new Error("无法创建素材目录。");
                if (!sub.create()) throw new Error("无法创建素材目录。");
                for (var f = 0; f < media.files.length; f++) {
                    var target = new File(sub.fsName + "/" + media.files[f].name);
                    if (!media.files[f].copy(target.fsName)) throw new Error("素材复制失败：" + media.files[f].fsName);
                    copied++;
                }
                var rel = "media/" + item.id + "/" + media.files[0].name;
                var tag = token + "_media_" + item.id;
                item.comment = tag;
                var replacement = new File(pack.fsName + "/" + rel);
                if (media.sequence) item.replaceWithSequence(replacement, false); else item.replace(replacement);
                lines.push("MEDIA|" + tag + "|" + encodeURIComponent(rel) + "|" + (media.sequence ? "1" : "0"));
            }
            app.project.save(project);
            write(new File(pack.fsName + "/preset.txt"), lines.join("\n"));
            finished = true;
        } finally {
            if (switched) {
                app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                if (!app.open(original)) throw new Error("预设处理结束，但原工程未恢复，请打开：" + original.fsName);
                restored();
            } else if (wrapper) { try { wrapper.remove(); } catch (e) {} }
            if (finished && snapshot.exists) snapshot.remove();
        }
        return finished;
    }
    function loadPreset(file, destination, localize, onLoaded) {
        var data = manifest(file), pack = file.parent;
        var project = new File(pack.fsName + "/project.aep");
        if (!project.exists) throw new Error("预设工程文件丢失。");
        for (var f = 0; f < data.footage.length; f++) {
            if (!/^media\/\d+\/[^\/\\]+$/.test(data.footage[f].path)) throw new Error("预设素材路径无效。");
            if (!new File(pack.fsName + "/" + data.footage[f].path).exists) throw new Error("预设素材缺失：" + data.footage[f].path);
        }
        var before = {};
        for (var i = 1; i <= app.project.numItems; i++) before["i" + app.project.item(i).id] = true;
        app.beginUndoGroup("加载序列帧预设");
        try {
            var imported = app.project.importFile(new ImportOptions(project));
            var root = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (before["i" + item.id]) continue;
                if (item instanceof CompItem && item.comment === data.token) root = item;
                if (item instanceof FootageItem) for (var f = 0; f < data.footage.length; f++) {
                    var media = data.footage[f];
                    if (item.comment === media.tag) {
                        var replacement = new File(pack.fsName + "/" + media.path);
                        if (media.sequence) item.replaceWithSequence(replacement, false); else item.replace(replacement);
                    }
                }
            }
            if (!root || root.numLayers !== 1) throw new Error("不能找到预设目标图层。");
            var target = root.layer(1), host = root;
            if (destination instanceof CompItem && Math.abs(destination.frameRate - data.fps) < 0.001) {
                target.copyToComp(destination);
                target = destination.layer(1);
                host = destination;
            }
            localize(target, data.rows, dropdown(target).name);
            host.openInViewer();
            for (var i = 1; i <= host.numLayers; i++) host.layer(i).selected = false;
            target.selected = true;
            onLoaded(data.rows, target);
            return "已加载预设：" + data.name + (host === root && destination instanceof CompItem ? "\n帧率不同，已打开预设合成。" : "");
        } finally { app.endUndoGroup(); }
    }
    function createUI(tab, getContext, localize, onLoaded, restored, report, isBusy) {
        tab.orientation = "column";
        tab.alignChildren = ["fill", "top"];
        tab.margins = 12;
        var pathGroup = tab.add("group");
        var pathText = pathGroup.add("statictext", [0, 0, 245, 24], "");
        var choose = pathGroup.add("button", undefined, "选择预设目录");
        var folder = new Folder(Folder.userData.fsName + "/SequenceActioner/Presets");
        if (app.settings.haveSetting("SequenceActioner", "presetFolder"))
            folder = new Folder(app.settings.getSetting("SequenceActioner", "presetFolder"));
        var parent = new Folder(Folder.userData.fsName + "/SequenceActioner");
        if (!parent.exists) parent.create();
        if (!folder.exists) folder.create();
        var list = tab.add("listbox", [0, 0, 390, 220], []);
        var nameRow = tab.add("group");
        nameRow.add("statictext", undefined, "预设名称");
        var name = nameRow.add("edittext", [0, 0, 270, 24], "");
        var buttons = tab.add("group");
        var save = buttons.add("button", undefined, "保存选中图层");
        var load = buttons.add("button", undefined, "加载预设");
        var refresh = buttons.add("button", undefined, "刷新列表");
        tab.add("statictext", [0, 0, 390, 48], "预设包含 AE 工程、动作配置和素材副本。\n移动或分享时，请复制整个预设文件夹。");
        function reload() {
            list.removeAll();
            pathText.text = folder.fsName;
            pathText.helpTip = folder.fsName;
            var folders = folder.getFiles(function(f) { return f instanceof Folder; });
            for (var i = 0; i < folders.length; i++) {
                var file = new File(folders[i].fsName + "/preset.txt");
                if (!file.exists) continue;
                try {
                    var data = manifest(file), row = list.add("item", data.name);
                    row.presetFile = file;
                } catch (e) {}
            }
        }
        choose.onClick = function() {
            var chosen = Folder.selectDialog("选择预设目录", folder);
            if (!chosen) return;
            folder = chosen;
            app.settings.saveSetting("SequenceActioner", "presetFolder", folder.fsName);
            reload();
        };
        refresh.onClick = reload;
        save.onClick = function() {
            try {
                if (isBusy && isBusy()) throw new Error("智能对齐正在执行，请等待完成。");
                var presetName = name.text.replace(/^\s+|\s+$/g, "");
                if (!presetName) throw new Error("请填写预设名称。");
                var context = getContext();
                save.enabled = load.enabled = false;
                report("正在保存预设并复制素材…");
                if (savePreset(folder, presetName, context, restored)) { reload(); report("已保存预设：" + presetName); }
            } catch (e) { alert("保存预设失败：\n" + e.toString()); }
            finally { save.enabled = load.enabled = true; }
        };
        load.onClick = function() {
            try {
                if (isBusy && isBusy()) throw new Error("智能对齐正在执行，请等待完成。");
                if (!list.selection) throw new Error("请选择预设。");
                report(loadPreset(list.selection.presetFile, app.project.activeItem, localize, onLoaded));
            } catch (e) { alert("加载预设失败：\n" + e.toString()); }
        };
        reload();
    }
    return {actions: actions, switchAction: switchAction, createUI: createUI};
})();

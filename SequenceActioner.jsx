// ================================================
// 序列帧动作控制脚本 v5
// 选中合成 → 刷新读取图层 → 编辑信息 → 确定应用
// 在目标图层上添加时间重映射表达式、菜单
// 帧数直接写入表达式，无需 Slider 控件
// ================================================
(function() {
    // Capture while this panel is loading; callback context may change $.fileName.
    var sequenceScriptFolder = new File($.fileName).parent.fsName;
    var win = new Window("palette", "序列帧动作控制", undefined, {resizeable: true});
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.margins = [12, 12, 12, 12];
    win.spacing = 10;

    // 标题
    var titleText = win.add("statictext", undefined, "序列帧动作控制");
    titleText.alignment = "center";
    var tf = titleText.graphics.font;
    titleText.graphics.font = ScriptUI.newFont(tf.name, ScriptUI.FontStyle.BOLD, tf.size + 4);

    var descText = win.add("statictext", undefined, "在主合成中选中【序列帧合成】\n点击读取内部图层 → 编辑 → 确定应用");
    descText.alignment = "center";
    descText.multiline = true;

    var pages = win.add("tabbedpanel");
    pages.alignment = ["fill", "top"];
    pages.alignChildren = ["fill", "top"];
    var actionPage = pages.add("tab", undefined, "动作控制");
    actionPage.orientation = "column";
    actionPage.alignChildren = ["fill", "top"];
    actionPage.margins = 10;
    var presetPage = pages.add("tab", undefined, "预设");
    pages.selection = actionPage;

    // 合成信息
    var compGroup = actionPage.add("panel", undefined, "选中合成");
    compGroup.orientation = "column";
    compGroup.alignChildren = ["fill", "top"];
    compGroup.spacing = 8;
    compGroup.margins = [10, 10, 10, 10];

    var compInfoText = compGroup.add("statictext", undefined, "请选中一个合成");
    compInfoText.alignment = "left";

    var refreshBtn = compGroup.add("button", undefined, "读取图层列表");

    // 图层列表（可编辑）
    var layerListGroup = actionPage.add("panel", undefined, "图层列表");
    layerListGroup.orientation = "column";
    layerListGroup.alignChildren = ["fill", "top"];
    layerListGroup.spacing = 6;
    layerListGroup.margins = [10, 10, 10, 10];

    var headerGroup = layerListGroup.add("group");
    headerGroup.orientation = "row";
    headerGroup.alignment = ["fill", "top"];
    headerGroup.spacing = 8;
    headerGroup.add("statictext", [0, 0, 50, 20], "切换");
    headerGroup.add("statictext", [0, 0, 120, 20], "图层名称");
    headerGroup.add("statictext", [0, 0, 60, 20], "帧数");
    headerGroup.add("statictext", [0, 0, 40, 20], "循环");

    var MAX_ROWS = 20;
    var VISIBLE_ROWS = 8;
    var scrollOffset = 0;
    var totalLayerCount = 0;
    var layerData = []; // 全部数据存储 [{name, frames, loop}, ...]

    // 可滚动列表区域
    var listContainer = layerListGroup.add("group");
    listContainer.orientation = "row";
    listContainer.alignment = ["fill", "top"];
    listContainer.spacing = 4;

    var actionRowsGroup = listContainer.add("group");
    actionRowsGroup.orientation = "column";
    actionRowsGroup.alignChildren = ["fill", "top"];
    actionRowsGroup.spacing = 4;

    // 竖向滚动条
    var scrollbar = listContainer.add("scrollbar", [0, 0, 14, 208], 0, 0, 0);
    scrollbar.minvalue = 0;
    scrollbar.maxvalue = 0;
    scrollbar.value = 0;
    scrollbar.stepdelta = 1;

    // 只创建 8 行作为视口
    var actionRows = [];
    for (var r = 0; r < VISIBLE_ROWS; r++) {
        var row = actionRowsGroup.add("group");
        row.orientation = "row";
        row.alignment = ["fill", "top"];
        row.spacing = 8;
        var switchBtn = row.add("button", [0, 0, 50, 22], "切换");
        switchBtn.enabled = false;
        switchBtn.viewportIndex = r;
        switchBtn.onClick = function() {
            try {
                if (!alignBtn.enabled) throw new Error("智能对齐正在执行，请等待完成。");
                saveViewportToData();
                var context = selectedContext();
                statusText.text = presetUtils.switchAction(context.comp, context.layer,
                    scrollOffset + this.viewportIndex, layerData);
            } catch (error) { alert(error.toString()); }
        };
        var ni = row.add("edittext", [0, 0, 120, 22], "");
        var fi = row.add("edittext", [0, 0, 60, 22], "");
        var cb = row.add("checkbox", [0, 0, 50, 22], "");
        cb.value = false;
        actionRows.push({ row: row, switchButton: switchBtn, nameInput: ni, framesInput: fi, loopCheckbox: cb });
    }

    // 把当前 8 行数据写回 layerData，防止编辑丢失
    function saveViewportToData() {
        for (var i = 0; i < VISIBLE_ROWS; i++) {
            var dataIdx = scrollOffset + i;
            if (dataIdx < layerData.length) {
                layerData[dataIdx].name = actionRows[i].nameInput.text;
                layerData[dataIdx].frames = actionRows[i].framesInput.text;
                layerData[dataIdx].loop = actionRows[i].loopCheckbox.value;
            }
        }
    }

    // 从 layerData 填充 8 行视口
    function loadViewportFromData() {
        for (var i = 0; i < VISIBLE_ROWS; i++) {
            var dataIdx = scrollOffset + i;
            actionRows[i].switchButton.enabled = dataIdx < layerData.length;
            if (dataIdx < layerData.length) {
                actionRows[i].nameInput.text = layerData[dataIdx].name;
                actionRows[i].framesInput.text = layerData[dataIdx].frames;
                actionRows[i].loopCheckbox.value = layerData[dataIdx].loop;
            } else {
                actionRows[i].nameInput.text = "";
                actionRows[i].framesInput.text = "";
                actionRows[i].loopCheckbox.value = false;
            }
        }
    }

    scrollbar.onChanging = function() {
        saveViewportToData();
        scrollOffset = Math.round(scrollbar.value);
        loadViewportFromData();
    };
    scrollbar.onChange = function() {
        saveViewportToData();
        scrollOffset = Math.round(scrollbar.value);
        loadViewportFromData();
    };

    // 两行按钮：确定 / 更新；自动排列 / 智能对齐
    var btnGroup = actionPage.add("group");
    btnGroup.orientation = "column";
    btnGroup.alignment = ["fill", "top"];
    btnGroup.alignChildren = ["fill", "top"];
    btnGroup.spacing = 8;

    var primaryBtnRow = btnGroup.add("group");
    primaryBtnRow.orientation = "row";
    primaryBtnRow.alignment = ["fill", "top"];
    primaryBtnRow.alignChildren = ["fill", "center"];
    primaryBtnRow.spacing = 10;
    var executeBtn = primaryBtnRow.add("button", undefined, "确定");
    var updateBtn = primaryBtnRow.add("button", undefined, "更新");

    var secondaryBtnRow = btnGroup.add("group");
    secondaryBtnRow.orientation = "row";
    secondaryBtnRow.alignment = ["fill", "top"];
    secondaryBtnRow.alignChildren = ["fill", "center"];
    secondaryBtnRow.spacing = 10;
    var arrangeBtn = secondaryBtnRow.add("button", undefined, "自动排列");
    var alignBtn = secondaryBtnRow.add("button", undefined, "智能对齐");

    // 状态
    var statusText = win.add("statictext", undefined, "");
    statusText.alignment = "center";
    statusText.multiline = true;

    // Shared preset/switch helper is evaluated within the panel engine.
    var presetUtils;
    try {
        var presetHelper = new File(sequenceScriptFolder + "/SequencePresetUtils.jsx");
        presetHelper.encoding = "UTF-8";
        if (!presetHelper.open("r")) throw new Error("找不到预设辅助脚本：" + presetHelper.fsName);
        var presetSource;
        try { presetSource = presetHelper.read().replace(/^\uFEFF/, ""); }
        finally { presetHelper.close(); }
        presetUtils = eval(presetSource);
        if (!presetUtils || typeof presetUtils.createUI !== "function") throw new Error("预设辅助脚本接口无效。");
    } catch (error) { alert(error.toString()); return; }

    function selectedContext() {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem) || comp.selectedLayers.length !== 1)
            throw new Error("请在当前合成中选中一个配置好的序列帧合成图层。");
        var layer = comp.selectedLayers[0];
        if (!(layer.source instanceof CompItem))
            throw new Error("选中图层必须是序列帧合成。");
        return {comp: comp, layer: layer};
    }
    function showActions(rows, target) {
        layerData = [];
        for (var i = 0; i < Math.min(rows.length, MAX_ROWS); i++)
            layerData.push({name: rows[i].name, frames: String(rows[i].frames), loop: rows[i].loop});
        totalLayerCount = layerData.length;
        scrollOffset = 0;
        scrollbar.value = 0;
        scrollbar.maxvalue = Math.max(0, layerData.length - VISIBLE_ROWS);
        loadViewportFromData();
        compInfoText.text = "源合成：" + target.source.name + " — " + layerData.length + " 个动作";
        pages.selection = actionPage;
        win.layout.layout(true);
    }
    presetUtils.createUI(presetPage, function() {
        saveViewportToData();
        var context = selectedContext();
        var configured = presetUtils.actions(context.layer);
        if (layerData.length) {
            if (configured.length !== layerData.length) throw new Error("请先更新目标配置，或重新读取目标图层。");
            for (var i = 0; i < configured.length; i++)
                if (configured[i].name !== layerData[i].name.replace(/^\s+|\s+$/g, "") ||
                        Number(configured[i].frames) !== Number(layerData[i].frames) ||
                        configured[i].loop !== layerData[i].loop)
                    throw new Error("列表存在未应用的修改，请先点击“确定”或“更新”。");
        }
        return context;
    }, function(target, rows, menuName) {
        var names = [], counts = [], loops = [];
        for (var i = 0; i < rows.length; i++) {
            names.push(rows[i].name); counts.push(Number(rows[i].frames)); loops.push(rows[i].loop);
        }
        target.property("ADBE Time Remapping").expression = buildExpression(menuName, names, counts, loops);
    }, showActions, function() {
        layerData = []; totalLayerCount = 0; scrollOffset = 0;
        scrollbar.value = 0; scrollbar.maxvalue = 0;
        loadViewportFromData();
        compInfoText.text = "原工程已恢复，请重新选中目标图层读取列表。";
    }, function(message) { statusText.text = message; win.update(); }, function() { return !alignBtn.enabled; });

    // ================================================
    // 读取合成内的有效图层
    // ================================================
    function getValidLayers(comp) {
        var layers = [];
        var seen = {};
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (layer.nullLayer) continue;
            if (layer.adjustmentLayer) continue;
            if (layer.name.indexOf("*") === 0) continue; // skip layers starting with *
            if (seen[layer.name]) continue;
            seen[layer.name] = true;

            var frameCount = Math.round((layer.outPoint - layer.inPoint) * comp.frameRate);
            if (frameCount <= 0) frameCount = 1;

            layers.push({ name: layer.name, frames: frameCount, inPoint: layer.inPoint });
        }
        // 按时间排序（inPoint 从小到大）
        layers.sort(function(a, b) { return a.inPoint - b.inPoint; });
        return layers;
    }

    // ================================================
    // 设置下拉菜单选项
    // ================================================
    function setDropdownOptions(menuEffect, optionsArray) {
        // 方式1: 直接在效果上设 (CS6+)
        try {
            menuEffect.setPropertyParameters(optionsArray);
            return true;
        } catch (e) {}
        // 方式2: 在内部 Menu 属性上设
        try {
            menuEffect.property(1).setPropertyParameters(optionsArray);
            return true;
        } catch (e) {}
        // 方式3: 用 matchName 找到 Menu 属性
        try {
            menuEffect.property("ADBE Dropdown Control-0001").setPropertyParameters(optionsArray);
            return true;
        } catch (e) {}
        return false;
    }

    // ================================================
    // 构建时间重映射表达式
    // ================================================
    function escapeExpressionText(value) {
        return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    }
    function buildExpression(menuName, actionNames, frameCounts, loopSettings) {
        var expr = "";
        expr += "var menu = effect(\"" + escapeExpressionText(menuName) + "\")(\"Menu\");\n";

        expr += "var actionNames = [";
        for (var i = 0; i < actionNames.length; i++) {
            if (i > 0) expr += ", ";
            expr += "\"" + escapeExpressionText(actionNames[i]) + "\"";
        }
        expr += "];\n";

        expr += "var frameCounts = [";
        for (var i = 0; i < frameCounts.length; i++) {
            if (i > 0) expr += ", ";
            expr += String(frameCounts[i]);
        }
        expr += "];\n";

        expr += "var loopSettings = [";
        for (var i = 0; i < loopSettings.length; i++) {
            if (i > 0) expr += ", ";
            expr += loopSettings[i] ? "true" : "false";
        }
        expr += "];\n";

        expr += "var startFrames = [];\n";
        expr += "var offset = 0;\n";
        expr += "for (var i = 0; i < frameCounts.length; i++) {\n";
        expr += "    startFrames[i] = offset;\n";
        expr += "    offset += Math.floor(frameCounts[i]);\n";
        expr += "}\n";

        expr += "var menuText = \"\";\n";
        expr += "if (menu.numKeys > 0) {\n";
        expr += "    for (var k = menu.numKeys; k >= 1; k--) {\n";
        expr += "        if (menu.key(k).time <= time) {\n";
        expr += "            menuText = menu.key(k).value;\n";
        expr += "            break;\n";
        expr += "        }\n";
        expr += "    }\n";
        expr += "} else {\n";
        expr += "    menuText = menu.value;\n";
        expr += "}\n";

        expr += "var hasForceNonLoop = false;\n";
        expr += "var idx = -1;\n";
        expr += "if (typeof menuText === \"number\") {\n";
        expr += "    idx = Math.round(menuText) - 1;\n";
        expr += "} else {\n";
        expr += "    if (menuText.indexOf(\"!\") === 0) {\n";
        expr += "        hasForceNonLoop = true;\n";
        expr += "        menuText = menuText.substring(1);\n";
        expr += "    }\n";
        expr += "    for (var i = 0; i < actionNames.length; i++) {\n";
        expr += "        if (actionNames[i] === menuText) {\n";
        expr += "            idx = i;\n";
        expr += "            break;\n";
        expr += "        }\n";
        expr += "    }\n";
        expr += "}\n";
        expr += "if (idx < 0) idx = 0;\n";

        expr += "var isLooping = hasForceNonLoop ? false : loopSettings[idx];\n";

        expr += "var switchTime = 0;\n";
        expr += "if (menu.numKeys > 0) {\n";
        expr += "    for (var k = 1; k <= menu.numKeys; k++) {\n";
        expr += "        if (menu.key(k).time <= time) {\n";
        expr += "            switchTime = menu.key(k).time;\n";
        expr += "        }\n";
        expr += "    }\n";
        expr += "}\n";

        expr += "var cnt = Math.floor(frameCounts[idx]);\n";
        expr += "if (cnt > 0) {\n";
        expr += "    var elapsed = time - switchTime;\n";
        expr += "    var f;\n";
        expr += "    if (isLooping) {\n";
        expr += "        f = Math.floor(elapsed / thisComp.frameDuration) % cnt;\n";
        expr += "    } else {\n";
        expr += "        f = Math.floor(elapsed / thisComp.frameDuration);\n";
        expr += "        if (f >= cnt) f = cnt - 1;\n";
        expr += "    }\n";
        expr += "    (startFrames[idx] + f) * thisComp.frameDuration;\n";
        expr += "} else {\n";
        expr += "    0;\n";
        expr += "}\n";

        return expr;
    }

    // ================================================
    // 执行 - 应用效果和表达式
    // ================================================
    function execute() {
        statusText.text = "";

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            alert("请先在项目面板中选中一个合成");
            return;
        }

        // 从可编辑行收集数据
        saveViewportToData();

        var actionNames = [];
        var frameCounts = [];
        var loopSettings = [];

        for (var i = 0; i < layerData.length; i++) {
            var nm = layerData[i].name.trim();
            var fc = parseInt(layerData[i].frames);
            if (nm === "" || isNaN(fc) || fc <= 0) continue;
            actionNames.push(nm);
            frameCounts.push(fc);
            loopSettings.push(layerData[i].loop);
        }

        if (actionNames.length === 0) {
            alert("请先读取图层列表，确保至少有一个有效图层");
            return;
        }

        // 目标图层：必须是时间轴中选中的图层
        var sel = comp.selectedLayers;
        if (sel.length === 0) {
            alert("请在时间轴中选中【序列帧合成】图层再点击确定");
            return;
        }
        var targetLayer = sel[0];

        app.beginUndoGroup("添加序列帧控件");

        try {
            var effects = targetLayer.property("ADBE Effect Parade");

            // ===== 1. 检测是否已有 Dropdown Control =====
            var hasDropdown = false;
            var dropdownIdx = -1;
            for (var i = 1; i <= effects.numProperties; i++) {
                var ef = effects.property(i);
                if (ef.matchName === "ADBE Dropdown Control") {
                    hasDropdown = true;
                    dropdownIdx = i;
                }
            }

            // ===== 2. 首次点击才创建控件 =====
            var dropdownName = "Dropdown Menu Control";
            if (!hasDropdown) {
                effects.addProperty("ADBE Dropdown Control");
                dropdownIdx = effects.numProperties;
                var dropdownProp = effects.property(dropdownIdx);
                setDropdownOptions(dropdownProp, actionNames);

                // setPropertyParameters 可能重建dropdown，扫描记录唯一的那个
                var foundIdx = -1;
                for (var i = 1; i <= effects.numProperties; i++) {
                    if (effects.property(i).matchName === "ADBE Dropdown Control") {
                        if (foundIdx === -1) {
                            foundIdx = i;
                        } else {
                            // 多出来的删掉
                            effects.property(i).remove();
                            i--;
                        }
                    }
                }
                if (foundIdx > 0) {
                    dropdownName = effects.property(foundIdx).name;
                    if (!dropdownName) dropdownName = "Dropdown Menu Control";
                    // 添加关键帧
                    try { effects.property(foundIdx).property(1).setValueAtTime(targetLayer.inPoint, 1); } catch (e) {}
                    try { effects.property(foundIdx).property("Menu").setValueAtTime(targetLayer.inPoint, 1); } catch (e) {}
                }
            } else {
                // 已存在，直接取当前名称，不碰它
                try { dropdownName = effects.property(dropdownIdx).name; } catch (e) {}
                if (!dropdownName) dropdownName = "Dropdown Menu Control";
            }

            // ===== 3. 只更新表达式 =====
            try {
                targetLayer.timeRemapEnabled = true;
            } catch (e) {
                statusText.text += "\n请手动启用时间重映射: 右键图层 > 时间 > 启用时间重映射";
            }

            var timeRemap = targetLayer.property("ADBE Time Remapping");
            if (!timeRemap) {
                try { targetLayer.timeRemapEnabled = true; } catch (e) {}
                timeRemap = targetLayer.property("ADBE Time Remapping");
            }

            if (!timeRemap) {
                alert("无法获取时间重映射属性。请手动启用后重新运行脚本。");
                app.endUndoGroup();
                return;
            }

            // 添加表达式
            var expr = buildExpression(dropdownName, actionNames, frameCounts, loopSettings);
            timeRemap.expression = expr;

            statusText.text = "完成！已配置 " + actionNames.length + " 个动作\n目标图层: " + targetLayer.name;

        } catch (e) {
            alert("错误: " + e.toString());
        }

        app.endUndoGroup();
    }

    // ================================================
    // 更新表达式 — 不动任何控件，只更新时间重映射表达式
    // ================================================
    function updateExpression() {
        statusText.text = "";

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            alert("请先在项目面板中选中一个合成");
            return;
        }

        var sel = comp.selectedLayers;
        if (sel.length === 0) {
            alert("请在时间轴中选中【序列帧合成】图层");
            return;
        }
        var targetLayer = sel[0];

        saveViewportToData();

        // 收集列表数据
        var actionNames = [];
        var frameCounts = [];
        var loopSettings = [];
        for (var i = 0; i < layerData.length; i++) {
            var nm = layerData[i].name.trim();
            var fc = parseInt(layerData[i].frames);
            if (nm === "" || isNaN(fc) || fc <= 0) continue;
            actionNames.push(nm);
            frameCounts.push(fc);
            loopSettings.push(layerData[i].loop);
        }
        if (actionNames.length === 0) {
            alert("列表为空，请先读取图层列表");
            return;
        }

        // 从已有效果中读取 dropdown 名称
        var dropdownName = "Dropdown Menu Control";
        try {
            var effects = targetLayer.property("ADBE Effect Parade");
            for (var i = 1; i <= effects.numProperties; i++) {
                if (effects.property(i).matchName === "ADBE Dropdown Control") {
                    dropdownName = effects.property(i).name;
                    break;
                }
            }
        } catch (e) {}

        // 启用时间重映射
        try { targetLayer.timeRemapEnabled = true; } catch (e) {}

        var timeRemap = targetLayer.property("ADBE Time Remapping");
        if (!timeRemap) {
            try { targetLayer.timeRemapEnabled = true; } catch (e) {}
            timeRemap = targetLayer.property("ADBE Time Remapping");
        }
        if (!timeRemap) {
            alert("无法获取时间重映射属性");
            return;
        }

        // 只更新表达式
        var expr = buildExpression(dropdownName, actionNames, frameCounts, loopSettings);
        timeRemap.expression = expr;

        statusText.text = "表达式已更新 — " + actionNames.length + " 个动作\n目标图层: " + targetLayer.name;
    }

    // ================================================
    // Auto Arrange — place selected layers end-to-end and adjust comp duration
    // ================================================
    function autoArrange() {
        statusText.text = "";
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            alert("请先打开一个合成");
            return;
        }
        var sel = comp.selectedLayers;
        if (sel.length < 2) {
            alert("请至少选中 2 个图层进行排列");
            return;
        }

        app.beginUndoGroup("Auto Arrange Layers");

        var offset = 0;
        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            var layerDuration = layer.outPoint - layer.inPoint;
            layer.startTime = offset;
            offset += layerDuration;
        }

        comp.duration = offset;

        app.endUndoGroup();

        statusText.text = "Auto-arranged " + sel.length + " layers, comp duration: " + offset.toFixed(2) + "s";
    }

    // ================================================
    // Smart first-frame alignment. The topmost selected layer is the reference.
    // Only Position is changed; anchor points are never modified.
    // ================================================
    function quotePowerShellArg(value) {
        return "'" + String(value).replace(/'/g, "''") + "'";
    }

    // Encode UTF-16LE so AE's command-line bridge never handles Unicode paths.
    function encodePowerShellCommand(value) {
        var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var bytes = [];
        for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i);
            bytes.push(code & 255);
            bytes.push((code >> 8) & 255);
        }
        var encoded = "";
        for (var i = 0; i < bytes.length; i += 3) {
            var a = bytes[i];
            var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
            var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
            encoded += alphabet.charAt(a >> 2);
            encoded += alphabet.charAt(((a & 3) << 4) | (b >> 4));
            encoded += i + 1 < bytes.length ? alphabet.charAt(((b & 15) << 2) | (c >> 6)) : "=";
            encoded += i + 2 < bytes.length ? alphabet.charAt(c & 63) : "=";
        }
        return encoded;
    }

    function getFootagePath(layer) {
        try {
            if (!(layer.source instanceof FootageItem)) return null;
            if (!layer.source.file) return null;
            return layer.source.file.fsName;
        } catch (e) { return null; }
    }

    function getPositionProperty(layer) {
        try {
            return layer.property("ADBE Transform Group").property("ADBE Position");
        } catch (e) { return null; }
    }

    function sourcePointToComp2D(layer, point) {
        // Explicit 2D transform: sourcePointToComp can return NaN for footage.
        var transform = layer.property("ADBE Transform Group");
        var anchor = transform.property("ADBE Anchor Point").value;
        var scale = transform.property("ADBE Scale").value;
        var rotation = transform.property("ADBE Rotate Z").value * Math.PI / 180;
        var position = transform.property("ADBE Position").value;
        var x = (point[0] - anchor[0]) * scale[0] / 100;
        var y = (point[1] - anchor[1]) * scale[1] / 100;
        return [
            position[0] + x * Math.cos(rotation) - y * Math.sin(rotation),
            position[1] + x * Math.sin(rotation) + y * Math.cos(rotation)
        ];
    }

    function offsetLayerPosition(layer, dx, dy) {
        if (!isFinite(dx) || !isFinite(dy)) {
            throw new Error("Invalid position offset for layer: " + layer.name);
        }
        var transform = layer.property("ADBE Transform Group");
        var position = transform.property("ADBE Position");
        if (position.dimensionsSeparated) {
            var xPosition = transform.property("ADBE Position_0");
            var yPosition = transform.property("ADBE Position_1");
            xPosition.setValue(xPosition.value + dx);
            yPosition.setValue(yPosition.value + dy);
        } else {
            var value = position.value;
            position.setValue([value[0] + dx, value[1] + dy]);
        }
    }

    function smartAlignFirstFrames() {
        statusText.text = "";
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            alert("Open the composition containing the sequence layers first.");
            return;
        }
        var selected = comp.selectedLayers;
        if (selected.length < 2) {
            alert("Select at least two sequence layers.\nThe topmost selected layer will be the reference.");
            return;
        }

        var layers = [];
        for (var i = 0; i < selected.length; i++) layers.push(selected[i]);
        layers.sort(function(a, b) { return a.index - b.index; });

        var referenceLayer = layers[0];
        var referencePath = getFootagePath(referenceLayer);
        if (!referencePath) {
            alert("The reference layer must be a footage sequence with an accessible source file.");
            return;
        }
        if (referenceLayer.threeDLayer || referenceLayer.parent !== null) {
            alert("The reference layer must be 2D and have no parent.");
            return;
        }

        var helperFile = new File(sequenceScriptFolder + "/SequenceAlignHelper.ps1");
        if (!helperFile.exists) {
            alert("Pixel-analysis helper not found:\n" + helperFile.fsName +
                "\n\nKeep it in the same folder as the JSX script.");
            return;
        }

        var targets = [];
        var targetPaths = [];
        var skippedBeforeMatch = 0;
        for (var i = 1; i < layers.length; i++) {
            var layer = layers[i];
            var position = getPositionProperty(layer);
            var path = getFootagePath(layer);
            if (!path || layer.threeDLayer || layer.parent !== null || layer.locked || !position ||
                position.numKeys > 0 || position.expressionEnabled) {
                skippedBeforeMatch++;
                continue;
            }
            targets.push(layer);
            targetPaths.push(path);
        }
        if (targets.length === 0) {
            alert("No eligible target layers were found.\nLayers must be 2D, unparented, unlocked, and their Position must have no keys or expression.");
            return;
        }

        statusText.text = "正在后台匹配首帧…";
        win.update();
        var layoutFile = new File(helperFile.parent.fsName + "/SequenceLayoutUtils.jsx");
        if (!layoutFile.exists) {
            alert("Layout helper not found: " + layoutFile.fsName);
            return;
        }
        // Read and evaluate inside this engine instead of converting an object
        // returned through $.evalFile's host boundary.
        var layoutUtils;
        layoutFile.encoding = "UTF-8";
        if (!layoutFile.open("r")) {
            throw new Error("无法读取辅助脚本：" + layoutFile.fsName);
        }
        var layoutSource;
        try {
            layoutSource = layoutFile.read().replace(/^\uFEFF/, "");
        } finally {
            layoutFile.close();
        }
        try {
            layoutUtils = eval(layoutSource);
        } catch (loadError) {
            throw new Error("辅助脚本加载失败：" + layoutFile.fsName +
                "\\n" + loadError.toString() + "（行 " + loadError.line + "）");
        }
        if (!layoutUtils || typeof layoutUtils.runHiddenAsync !== "function" ||
                typeof layoutUtils.fit !== "function" ||
                typeof layoutUtils.fingerprint !== "function") {
            throw new Error("辅助脚本接口无效：" + layoutFile.fsName);
        }
        var resultFile = new File(Folder.temp.fsName + "/SequenceAlign_" +
            new Date().getTime() + "_" + Math.floor(Math.random() * 1000000) + ".txt");
        var progressFile = new File(resultFile.fsName + ".progress");
        var scriptCommand = "& " +
            quotePowerShellArg(helperFile.fsName) + " -Reference " + quotePowerShellArg(referencePath) +
            " -TargetList " + quotePowerShellArg(targetPaths.join("|")) +
            " -OutputPath " + quotePowerShellArg(resultFile.fsName) +
            " -ProgressPath " + quotePowerShellArg(progressFile.fsName);
        var command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " +
            encodePowerShellCommand(scriptCommand);
        var initialState = layoutUtils.fingerprint(comp);
        function reportError(error) {
            statusText.text = "处理已停止。";
            alignBtn.enabled = true;
            alert("序列帧处理失败：\n" + error.toString());
        }
        layoutUtils.runHiddenAsync(command, {progressFile: progressFile,
            onProgress: function(completed, total, elapsed) {
                if (!win.visible) return;
                var percent = Math.min(99, Math.floor(completed * 100 / total));
                statusText.text = "正在匹配首帧：" + completed + " / " + total +
                    " 个图层（" + percent + "%） · " + elapsed + " 秒";
            }},
            function() {
                try {
                    if (!win.visible || layoutUtils.fingerprint(comp) !== initialState)
                        throw new Error("分析期间合成或图层发生变化，已取消应用结果。请重新运行。");
                    var output = "";
                    resultFile.encoding = "UTF-8";
                    if (resultFile.exists && resultFile.open("r")) {
                        output = resultFile.read().replace(/^\uFEFF/, "");
                        resultFile.close();
                        try { resultFile.remove(); } catch (e) {}
                    }
        var matches = {};
        var lines = String(output).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].split("|");
            if (parts.length >= 6 && parts[0] === "ALIGN") {
                matches[parseInt(parts[1], 10)] = {
                    dx: parseFloat(parts[2]),
                    dy: parseFloat(parts[3]),
                    confidence: parseFloat(parts[4])
                };
            }
        }
        if (String(output).indexOf("ALIGN|") < 0) {
            alert("Pixel analysis returned no valid result.\n\n" +
                (String(output) || "No result file was produced by the helper.") +
                "\n\nReference: " + referencePath + "\nHelper: " + helperFile.fsName);
            statusText.text = "";
            throw new Error("匹配结果无效。");
        }


                    var aligned = 0, lowConfidence = 0, failed = 0;
                    app.beginUndoGroup("首帧智能对齐");
                    try {
            for (var i = 0; i < targets.length; i++) {
                var match = matches[i];
                if (!match || isNaN(match.dx) || isNaN(match.dy)) {
                    failed++;
                    continue;
                }
                if (match.confidence < 0.15) {
                    lowConfidence++;
                    continue;
                }
                var targetLayer = targets[i];
                var targetPoint = [targetLayer.source.width / 2, targetLayer.source.height / 2];
                var referencePoint = [targetPoint[0] + match.dx, targetPoint[1] + match.dy];
                var targetCompPoint = sourcePointToComp2D(targetLayer, targetPoint);
                var referenceCompPoint = sourcePointToComp2D(referenceLayer, referencePoint);
                offsetLayerPosition(targetLayer,
                    referenceCompPoint[0] - targetCompPoint[0],
                    referenceCompPoint[1] - targetCompPoint[1]);
                aligned++;
            }

                    } finally { app.endUndoGroup(); }
                    function complete(summary) {
                        var skipped = skippedBeforeMatch + lowConfidence + failed;
                        statusText.text = "已对齐 " + aligned + " 个图层，跳过 " + skipped +
                            " 个\n参考: " + referenceLayer.name + (summary ? "\n合成尺寸: " + summary : "");
                        alignBtn.enabled = true;
                        if (lowConfidence > 0) alert(lowConfidence + " 个图层因匹配置信度不足未移动。");
                    }
                    if (!aligned) { complete(""); return; }
                    statusText.text = "正在按素材尺寸适配合成…";
                    layoutUtils.fit(comp, helperFile, encodePowerShellCommand, quotePowerShellArg,
                        complete, function(error) {
                            complete("未适配");
                            alert("对齐已完成，但尺寸适配未完成：\n" + error.toString());
                        });
                } catch (error) { reportError(error); }
            }, reportError);
        return true;
    }
    // ================================================
    // 事件绑定
    // ================================================

    // 刷新：读取选中图层指向的源合成内的图层，填入预创建行
    refreshBtn.onClick = function() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            compInfoText.text = "请先打开一个合成";
            return;
        }

        var sel = comp.selectedLayers;
        if (sel.length === 0) {
            compInfoText.text = "请在时间轴中选中【序列帧合成】图层";
            return;
        }

        var selectedLayer = sel[0];

        if (!(selectedLayer.source instanceof CompItem)) {
            compInfoText.text = "选中的图层 \"" + selectedLayer.name + "\" 不是合成";
            return;
        }

        var sourceComp = selectedLayer.source;
        try {
            var configuredRows = presetUtils.actions(selectedLayer);
            showActions(configuredRows, selectedLayer);
            statusText.text = "已读取目标的动作设置。";
            return;
        } catch (unconfigured) {}

        var layers = getValidLayers(sourceComp);

        // 先清空视口
        for (var i = 0; i < VISIBLE_ROWS; i++) {
            actionRows[i].nameInput.text = "";
            actionRows[i].framesInput.text = "";
            actionRows[i].loopCheckbox.value = false;
        }
        totalLayerCount = 0;
        scrollOffset = 0;

        if (layers.length === 0) {
            layerData = [];
            scrollbar.maxvalue = 0;
            scrollbar.value = 0;
            loadViewportFromData();
            compInfoText.text = "\"" + sourceComp.name + "\" — 没有有效图层";
            win.layout.resize();
            return;
        }

        // 存入 layerData
        totalLayerCount = Math.min(layers.length, MAX_ROWS);
        layerData = [];
        for (var i = 0; i < totalLayerCount; i++) {
            layerData.push({
                name: layers[i].name,
                frames: layers[i].frames.toString(),
                loop: false
            });
        }

        // 设置滚动条范围
        if (totalLayerCount > VISIBLE_ROWS) {
            scrollbar.maxvalue = totalLayerCount - VISIBLE_ROWS;
        } else {
            scrollbar.maxvalue = 0;
        }
        scrollbar.value = 0;
        scrollOffset = 0;
        loadViewportFromData();

        compInfoText.text = "源合成: \"" + sourceComp.name + "\" — " + layers.length + " 个图层";
        statusText.text = "";

        win.layout.resize();
    };

    executeBtn.onClick = execute;
    updateBtn.onClick = updateExpression;
    arrangeBtn.onClick = autoArrange;
    alignBtn.onClick = function() {
        alignBtn.enabled = false;
        try { if (smartAlignFirstFrames() !== true) alignBtn.enabled = true; }
        catch (error) { alignBtn.enabled = true; alert(error.toString()); }
    };

    // ================================================
    // 显示窗口
    // ================================================
    win.center();
    win.show();
})();

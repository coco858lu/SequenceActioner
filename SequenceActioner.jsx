// ================================================
// 序列帧动作控制脚本 v5
// 选中合成 → 刷新读取图层 → 编辑信息 → 确定应用
// 在目标图层上添加时间重映射表达式、菜单
// 帧数直接写入表达式，无需 Slider 控件
// ================================================
(function() {
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

    // 合成信息
    var compGroup = win.add("panel", undefined, "选中合成");
    compGroup.orientation = "column";
    compGroup.alignChildren = ["fill", "top"];
    compGroup.spacing = 8;
    compGroup.margins = [10, 10, 10, 10];

    var compInfoText = compGroup.add("statictext", undefined, "请选中一个合成");
    compInfoText.alignment = "left";

    var refreshBtn = compGroup.add("button", undefined, "读取图层列表");

    // 图层列表（可编辑）
    var layerListGroup = win.add("panel", undefined, "图层列表");
    layerListGroup.orientation = "column";
    layerListGroup.alignChildren = ["fill", "top"];
    layerListGroup.spacing = 6;
    layerListGroup.margins = [10, 10, 10, 10];

    var headerGroup = layerListGroup.add("group");
    headerGroup.orientation = "row";
    headerGroup.alignment = ["fill", "top"];
    headerGroup.spacing = 8;
    headerGroup.add("statictext", [0, 0, 100, 20], "图层名称");
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
        var ni = row.add("edittext", [0, 0, 120, 22], "");
        var fi = row.add("edittext", [0, 0, 60, 22], "");
        var cb = row.add("checkbox", [0, 0, 50, 22], "");
        cb.value = false;
        actionRows.push({ row: row, nameInput: ni, framesInput: fi, loopCheckbox: cb });
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

    // 按钮行
    var btnGroup = win.add("group");
    btnGroup.orientation = "row";
    btnGroup.alignment = ["fill", "top"];
    btnGroup.spacing = 10;

    var executeBtn = btnGroup.add("button", undefined, "确定");
    var updateBtn = btnGroup.add("button", undefined, "更新");

    // 状态
    var statusText = win.add("statictext", undefined, "");
    statusText.alignment = "center";
    statusText.multiline = true;

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
    function buildExpression(menuName, actionNames, frameCounts, loopSettings) {
        var expr = "";
        expr += "var menu = effect(\"" + menuName + "\")(\"Menu\");\n";

        expr += "var actionNames = [";
        for (var i = 0; i < actionNames.length; i++) {
            if (i > 0) expr += ", ";
            expr += "\"" + actionNames[i] + "\"";
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

    // ================================================
    // 显示窗口
    // ================================================
    win.center();
    win.show();
})();

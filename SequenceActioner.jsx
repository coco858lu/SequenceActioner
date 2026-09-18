// ================================================
// 序列帧动作控制脚本 · 中英文 AE 通用单文件版
// 选中合成 → 刷新读取图层 → 编辑信息 → 确定应用
// 在目标图层上添加时间重映射表达式、菜单
// 帧数直接写入表达式，无需 Slider 控件
// ================================================
(function(panelHost) {
    // Dispose previous polling closures before building the replacement docked panel.
    // AE can invalidate a closed panel while its ExtendScript callbacks remain alive.
    var previousWatchers = $.global.__SequenceActionerWatchers;
    if (previousWatchers) {
        for (var previousId in previousWatchers) {
            if (!previousWatchers.hasOwnProperty(previousId)) continue;
            try { previousWatchers[previousId].stop(); } catch (oldWatcherError) {}
            delete previousWatchers[previousId];
        }
    }
    // Single-file edition: property indices and matchNames are independent of AE language.
    if (!String.prototype.trim) {
        String.prototype.trim = function() { return this.replace(/^\s+|\s+$/g, ""); };
    }
    var presetUtils = createPresetUtils();
    var layoutUtils = createLayoutUtils();
    var isDocked = typeof Panel !== "undefined" && panelHost instanceof Panel;
    var win = isDocked ? panelHost : new Window("palette", "序列帧动作控制", undefined, {resizeable: true});
    function repaint() { if (typeof win.update === "function") win.update(); }
    win.onResizing = win.onResize = function() { this.layout.resize(); };
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.margins = [12, 12, 12, 12];
    win.spacing = 10;

    var pages = win.add("tabbedpanel");
    pages.alignment = ["fill", "top"];
    pages.alignChildren = ["fill", "top"];
    var actionPage = pages.add("tab", undefined, "动作控制");
    actionPage.orientation = "column";
    actionPage.alignChildren = ["fill", "top"];
    actionPage.margins = 10;
    actionPage.spacing = 6;
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


    // 图层列表（可编辑）
    var layerListGroup = actionPage.add("panel", undefined, "图层列表");
    layerListGroup.orientation = "column";
    layerListGroup.alignChildren = ["fill", "top"];
    layerListGroup.spacing = 6;
    layerListGroup.margins = [10, 10, 10, 10];

    var rowCountGroup = layerListGroup.add("group");
    rowCountGroup.orientation = "row";
    rowCountGroup.add("statictext", undefined, "显示行数");
    var rowCountInput = rowCountGroup.add("edittext", [0, 0, 48, 22], "8");
    rowCountInput.helpTip = "输入 1–64 的整数，按 Enter 或离开输入框后生效。显示更多行需要更高的面板。";

    var headerGroup = layerListGroup.add("group");
    headerGroup.orientation = "row";
    headerGroup.alignment = ["fill", "top"];
    headerGroup.spacing = 8;
    var switchHeader = headerGroup.add("statictext", [0, 0, 120, 20], "切换");
    headerGroup.add("statictext", [0, 0, 120, 20], "图层名称");
    headerGroup.add("statictext", [0, 0, 60, 20], "帧数");
    headerGroup.add("statictext", [0, 0, 40, 20], "循环");

    var MAX_ROWS = 64;
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

    // Create only the requested editor rows; no hidden 64-row control pool.
    var actionRows = [];
    function appendActionRow() {
        var r = actionRows.length;
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
    for (var r = 0; r < VISIBLE_ROWS; r++) appendActionRow();

    rowCountInput.onChange = function() {
        var text = this.text.replace(/^\s+|\s+$/g, ""), count = Number(text);
        if (!/^\d+$/.test(text) || count < 1 || count > MAX_ROWS) {
            this.text = String(VISIBLE_ROWS);
            alert("显示行数请输入 1–" + MAX_ROWS + " 的整数。");
            return;
        }
        this.text = String(count);
        if (count === VISIBLE_ROWS) return;
        saveViewportToData();
        var oldCount = VISIBLE_ROWS;
        var oldSize = [win.size.width || win.size[0], win.size.height || win.size[1]];
        while (actionRows.length > count) actionRowsGroup.remove(actionRows.pop().row);
        while (actionRows.length < count) appendActionRow();
        VISIBLE_ROWS = count;
        scrollbar.maxvalue = Math.max(0, layerData.length - VISIBLE_ROWS);
        scrollOffset = Math.max(0, Math.min(scrollOffset, scrollbar.maxvalue));
        scrollbar.value = scrollOffset;
        var height = count * 26 - 4;
        scrollbar.minimumSize = [14, height];
        scrollbar.maximumSize = [14, height];
        scrollbar.preferredSize = [14, height];
        scrollbar.enabled = scrollbar.maxvalue > 0;
        loadViewportFromData();
        setUniformButtonWidths(win);
        win.layout.layout(true);
        if (!isDocked) win.size = [oldSize[0], Math.max(200, oldSize[1] + (count - oldCount) * 26)];
        win.layout.resize();
        repaint();
    };

    // 把当前可见行数据写回 layerData，防止编辑丢失
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

    // 从 layerData 填充当前视口
    function loadViewportFromData() {
        scrollbar.enabled = layerData.length > VISIBLE_ROWS;
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

    // 两行按钮：确定 / 更新；智能对齐 / 自动排列
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
    var alignBtn = secondaryBtnRow.add("button", undefined, "智能对齐");
    var arrangeBtn = secondaryBtnRow.add("button", undefined, "自动排列");

    var createControlBtn = actionPage.add("button", undefined, "创建动作控制合成");
    createControlBtn.alignment = ["fill", "top"];
    createControlBtn.helpTip = "先在合成 A 中对齐、排列动作，再一键创建包含 A 的控制合成 B，并读取动作列表。";

    // 状态
    var progressRow = actionPage.add("group");
    progressRow.alignment = ["fill", "top"];
    progressRow.alignChildren = ["fill", "center"];
    var alignProgress = progressRow.add("progressbar", undefined, 0, 100);
    alignProgress.preferredSize = [310, 14];
    alignProgress.enabled = false;
    var progressPercent = progressRow.add("statictext", undefined, "就绪");
    progressPercent.alignment = ["right", "center"];
    progressPercent.preferredSize = [60, 20];
    function showAlignProgress(value, label) {
        alignProgress.value = value;
        progressPercent.text = label;
    }
    var statusText = win.add("statictext", undefined, "");
    statusText.alignment = "center";
    statusText.multiline = true;

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
    }, function(rows, target) {
        showActions(rows, target);
        recordLoadedSelection();
    }, function() {
        layerData = []; totalLayerCount = 0; scrollOffset = 0;
        loadedSelection = ""; loadedLayer = null; selectionDrafts = {};
        watchedProject = app.project;
        scrollbar.value = 0; scrollbar.maxvalue = 0;
        loadViewportFromData();
        compInfoText.text = "原工程已恢复，请重新选中目标图层读取列表。";
    }, function(message) { statusText.text = message; repaint(); }, function() { return !alignBtn.enabled; });

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
        expr += "var menu = effect(\"" + escapeExpressionText(menuName) + "\")(1);\n";

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
            alert("请选中序列帧合成图层，等待自动读取，确保至少有一个有效动作");
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
                if (presetUtils.isDropdownEffect(ef)) {
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
                    if (presetUtils.isDropdownEffect(effects.property(i))) {
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
            alert("列表为空，请选中序列帧合成图层，等待自动读取");
            return;
        }

        // 从已有效果中读取 dropdown 名称
        var dropdownName = "Dropdown Menu Control";
        try {
            var effects = targetLayer.property("ADBE Effect Parade");
            for (var i = 1; i <= effects.numProperties; i++) {
                if (presetUtils.isDropdownEffect(effects.property(i))) {
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

        statusText.text = "已排列 " + sel.length + " 个图层，合成时长: " + offset.toFixed(2) + " 秒";
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
            throw new Error("图层位移计算无效: " + layer.name);
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
            alert("请先打开包含序列帧图层的合成。");
            return;
        }
        var selected = comp.selectedLayers;
        if (selected.length < 2) {
            alert("请至少选中 2 个序列帧图层。\n最上方的选中图层将作为参考。");
            return;
        }

        var layers = [];
        for (var i = 0; i < selected.length; i++) layers.push(selected[i]);
        layers.sort(function(a, b) { return a.index - b.index; });

        var referenceLayer = layers[0];
        var referencePath = getFootagePath(referenceLayer);
        if (!referencePath) {
            alert("参考图层必须是有源文件的序列帧素材图层。");
            return;
        }
        if (referenceLayer.threeDLayer || referenceLayer.parent !== null) {
            alert("参考图层必须是二维且没有父级。");
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
            alert("没有可对齐的目标图层。\n请确保图层是二维、无父级、未锁定，且位置没有关键帧或表达式。");
            return;
        }

        statusText.text = "正在后台匹配首帧…";
        repaint();
        var resultFile = new File(Folder.temp.fsName + "/SequenceAlign_" +
            new Date().getTime() + "_" + Math.floor(Math.random() * 1000000) + ".txt");
        var progressFile = new File(resultFile.fsName + ".progress");
        var helperFile = createAlignmentWorker();
        var scriptCommand = "& " +
            quotePowerShellArg(helperFile.fsName) + " -Reference " + quotePowerShellArg(referencePath) +
            " -TargetList " + quotePowerShellArg(targetPaths.join("|")) +
            " -OutputPath " + quotePowerShellArg(resultFile.fsName) +
            " -ProgressPath " + quotePowerShellArg(progressFile.fsName);
        var command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " +
            encodePowerShellCommand(scriptCommand);
        var initialState = layoutUtils.fingerprint(comp);
        function reportError(error) {
            showAlignProgress(0, "已停止");
            alignProgress.enabled = false;
            statusText.text = "处理已停止。";
            alignBtn.enabled = true;
            alert("序列帧处理失败：\n" + error.toString());
        }
        layoutUtils.runHiddenAsync(command, {progressFile: progressFile, workerFile: helperFile,
            onWaiting: function(elapsed) {
                if (!win.visible) return;
                statusText.text = "正在启动后台分析… · " + elapsed + " 秒";
                repaint();
            },
            onProgress: function(completed, total, elapsed) {
                if (!win.visible) return;
                var percent = Math.max(0, Math.min(99, Math.floor(completed * 100 / total)));
                showAlignProgress(percent, percent + "%");
                var phase = completed <= total / 2 ? "首帧匹配" : "交叉核验";
                statusText.text = phase + " · " + completed + "/" + total + " · 已用 " + elapsed + " 秒";
                repaint();
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
        var matches = {}, matchErrors = {}, skippedDetails = [];
        var lines = String(output).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].split("|");
            if (parts[0] === "ERROR" && parts.length >= 3) {
                matchErrors[parseInt(parts[1], 10)] = parts.slice(2).join(" / ");
            }
            if (parts.length >= 6 && parts[0] === "ALIGN") {
                matches[parseInt(parts[1], 10)] = {
                    dx: parseFloat(parts[2]),
                    dy: parseFloat(parts[3]),
                    confidence: parseFloat(parts[4])
                };
            }
        }
        if (String(output).indexOf("ALIGN|") < 0) {
            var messages = [];
            for (var i = 0; i < targets.length; i++)
                if (matchErrors[i]) messages.push(targets[i].name + "：" + matchErrors[i]);
            throw new Error("首帧匹配未产生可用结果：\n" +
                (messages.length ? messages.join("\n") : String(output) || "后台未生成结果文件。"));
        }


                    var aligned = 0, lowConfidence = 0, failed = 0;
                    app.beginUndoGroup("首帧智能对齐");
                    try {
            for (var i = 0; i < targets.length; i++) {
                var match = matches[i];
                if (!match || !isFinite(match.dx) || !isFinite(match.dy) || !isFinite(match.confidence)) {
                    failed++;
                    skippedDetails.push(targets[i].name + "：" + (matchErrors[i] || "结果无效"));
                    continue;
                }
                if (match.confidence < 0.15) {
                    lowConfidence++;
                    skippedDetails.push(targets[i].name + "：颜色纹理核验不足或存在多个相近候选，未移动");
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
                        showAlignProgress(100, "完成");
                        alignProgress.enabled = false;
                        var skipped = skippedBeforeMatch + lowConfidence + failed;
                        statusText.text = "已对齐 " + aligned + " 个图层，跳过 " + skipped +
                            " 个\n参考: " + referenceLayer.name + (summary ? "\n合成尺寸: " + summary : "");
                        alignBtn.enabled = true;
                        if (skippedDetails.length) alert("以下图层未移动：\n" + skippedDetails.join("\n") +
                            "\n\n姿势或特效差异较大时，请手动确定参考点。");
                    }
                    if (!aligned) { complete(""); return; }
                    showAlignProgress(99, "99%");
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
    function manualRead() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            compInfoText.text = "请先打开一个合成";
            return;
        }

        var selection = contextSelection();
        if (!selection) {
            compInfoText.text = "请在时间轴中选中一个【序列帧合成】图层";
            return;
        }
        var selectedLayer = selection.layer;
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
        alignProgress.enabled = true;
        showAlignProgress(0, "0%");
        statusText.text = "正在准备智能对齐…";
        repaint();
        try {
            if (smartAlignFirstFrames() !== true) {
                alignBtn.enabled = true;
                alignProgress.enabled = false;
                showAlignProgress(0, "就绪");
            }
        } catch (error) {
            alignBtn.enabled = true;
            alignProgress.enabled = false;
            showAlignProgress(0, "已停止");
            alert(error.toString());
        }
    };

    // Lightweight selection watching: only read layers after the selected target changes.
    var loadedSelection = "", loadedSignature = "", loadedLayer = null;
    var selectionDrafts = {}, watchedProject = null;
    function rowSignature() {
        var values = [];
        for (var i = 0; i < layerData.length; i++)
            values.push(layerData[i].name, layerData[i].frames, layerData[i].loop);
        return values.join("\u0001");
    }
    function contextSelection() {
        var comp = app.project ? app.project.activeItem : null;
        if (!(comp instanceof CompItem)) return null;
        var selected = comp.selectedLayers, layer = null;
        if (selected.length === 1 && selected[0].source instanceof CompItem) layer = selected[0];
        // Imported preset host comps have one configured precomp layer. Merely
        // changing their timeline tab should work even if that layer is not selected.
        if (!layer && selected.length === 0 && comp.numLayers === 1) {
            var onlyLayer = comp.layer(1);
            if (onlyLayer.source instanceof CompItem) {
                try { presetUtils.actions(onlyLayer); layer = onlyLayer; } catch (e) {}
            }
        }
        if (!layer) return null;
        if (!(layer.source instanceof CompItem)) return null;
        // Layer.id is unavailable before AE 22. Use the index on older versions.
        var layerKey = typeof layer.id !== "undefined" ? layer.id : "index_" + layer.index;
        return {comp: comp, layer: layer, key: comp.id + ":" + layerKey + ":" + layer.source.id};
    }
    function copyRows(rows) {
        var result = [];
        for (var i = 0; i < rows.length; i++)
            result.push({name: rows[i].name, frames: String(rows[i].frames), loop: rows[i].loop});
        return result;
    }
    function recordLoadedSelection() {
        var selected = contextSelection();
        loadedSelection = selected ? selected.key : "";
        loadedLayer = selected ? selected.layer : null;
        loadedSignature = rowSignature();
        watchedProject = app.project;
        if (loadedSelection) delete selectionDrafts[loadedSelection];
    }
    function rememberDraft() {
        if (!loadedSelection || !loadedLayer) return;
        saveViewportToData();
        if (rowSignature() !== loadedSignature) {
            try {
                selectionDrafts[loadedSelection] = {rows: copyRows(layerData),
                    expression: loadedLayer.property("ADBE Time Remapping").expression};
            } catch (e) { selectionDrafts[loadedSelection] = {rows: copyRows(layerData), expression: ""}; }
        }
    }
    function readSelectedActions() {
        manualRead();
        recordLoadedSelection();
    };
    createControlBtn.onClick = function() {
        try {
            if (!alignBtn.enabled) throw new Error("智能对齐正在执行，请等待完成。");
            var source = app.project.activeItem;
            if (!(source instanceof CompItem)) throw new Error("请先打开或选中已经对齐、排列好的动作序列帧合成 A。");
            if (/^SequenceActionerControl\|/.test(source.comment || ""))
                throw new Error("当前已经是动作控制合成 B。请先进入内部的动作序列帧合成 A。");
            var valid = getValidLayers(source);
            if (!valid.length) throw new Error("当前合成没有可读取的动作图层。");
            if (valid.length > MAX_ROWS) throw new Error("动作数超过 " + MAX_ROWS + "，请先拆分动作组。");
            for (var i = 1; i <= source.numLayers; i++) {
                var layer = source.layer(i), configured = false;
                try { configured = presetUtils.actions(layer).length > 0; } catch (e) {}
                if (configured) throw new Error("当前是已配置动作菜单的控制合成。请进入其内部的动作序列帧合成 A，再创建。");
            }
            var baseName = source.name + "_动作控制", name = baseName, suffix = 2;
            var names = {};
            for (var i = 1; i <= app.project.numItems; i++) names["n_" + app.project.item(i).name] = true;
            while (names["n_" + name]) name = baseName + "_" + suffix++;
            var created = null, target = null;
            app.beginUndoGroup("创建动作控制合成");
            try {
                created = app.project.items.addComp(name, source.width, source.height,
                    source.pixelAspect, source.duration, source.frameRate);
                created.parentFolder = source.parentFolder;
                created.bgColor = source.bgColor;
                created.comment = "SequenceActionerControl|" + source.id;
                target = created.layers.add(source);
                target.name = source.name;
                target.startTime = 0;
                target.inPoint = 0;
                target.outPoint = source.duration;
                target.selected = true;
            } catch (e) {
                if (created) { try { created.remove(); } catch (cleanupError) {} }
                throw e;
            } finally { app.endUndoGroup(); }
            rememberDraft();
            created.openInViewer();
            pages.selection = actionPage;
            readSelectedActions();
            statusText.text = "已创建：" + name + "\n请勾选循环动作，然后点击“确定”。";
            win.layout.layout(true);
            repaint();
        } catch (e) { alert("创建动作控制合成失败：\n" + e.toString()); }
    };
    function followSelection() {
        if (!alignBtn.enabled) return;
        if (watchedProject !== app.project) {
            selectionDrafts = {};
            loadedSelection = ""; loadedLayer = null;
            watchedProject = app.project;
        }
        var selected = contextSelection();
        if (!selected || selected.key === loadedSelection) return;
        rememberDraft();
        var draft = selectionDrafts[selected.key];
        var activeTab = pages.selection;
        manualRead();
        recordLoadedSelection();
        if (draft) {
            var expression = "";
            try { expression = selected.layer.property("ADBE Time Remapping").expression; } catch (e) {}
            if (draft.expression === expression) {
                showActions(draft.rows, selected.layer);
                statusText.text = "已恢复该图层尚未应用的编辑。";
            }
        }
        // Updating the action data must not depend on ScriptUI host-object identity,
        // nor force the user out of the preset tab.
        pages.selection = activeTab;
        repaint();
    }
    function watchSelection() {
        if (!$.global.__SequenceActionerWatchers) $.global.__SequenceActionerWatchers = {};
        var registry = $.global.__SequenceActionerWatchers;
        for (var old in registry) {
            if (registry.hasOwnProperty(old)) {
                try { registry[old].stop(); } catch (oldWatcherError) {}
                delete registry[old];
            }
        }
        var id = "panel_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000000);
        var task = null, stopped = false;
        function stop() {
            stopped = true;
            if (task !== null) { try { app.cancelTask(task); } catch (e) {} }
            delete registry[id];
        }
        function schedule() {
            if (!stopped) task = app.scheduleTask("if ($.global.__SequenceActionerWatchers && $.global.__SequenceActionerWatchers['" + id + "']) $.global.__SequenceActionerWatchers['" + id + "'].poll();", 600, false);
        }
        registry[id] = {stop: stop, poll: function() {
            if (stopped) return;
            try {
                followSelection();
            } catch (e) {
                // A destroyed host must not throw again while trying to display the first error.
                try {
                    if (/object is invalid|invalid object|对象无效|对象是无效/i.test(e.toString())) {
                        stop();
                        return;
                    }
                    statusText.text = "自动读取暂未成功：" + e.toString() + "（将自动重试）";
                } catch (invalidPanelError) { stop(); return; }
            }
            schedule();
        }};
        if (!isDocked) win.onClose = function() { stop(); return true; };
        schedule();
    }

    function createAlignmentWorker() {
        var file = new File(Folder.temp.fsName + "/SequenceActioner_Worker_" +
            new Date().getTime() + "_" + Math.floor(Math.random() * 1000000000) + ".ps1");
        var source = [
            "param(",
            "    [string]$Reference = \"\",",
            "",
            "    [Parameter(Mandatory = $true)]",
            "    [string]$TargetList,",
            "",
            "    [string]$OutputPath = \"\",",
            "    [switch]$BoundsOnly,",
            "    [string]$FrameCounts = \"\",",
            "    [string]$ProgressPath = \"\"",
            ")",
            "",
            "$ErrorActionPreference = \"Stop\"",
            "try {",
            "    [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = \"BelowNormal\"",
            "}",
            "catch { } # Do not fail analysis if process priority cannot be changed.",
            "",
            "$source = @'",
            "using System;",
            "using System.Drawing;",
            "using System.Drawing.Drawing2D;",
            "using System.Drawing.Imaging;",
            "using System.Numerics;",
            "using System.Runtime.InteropServices;",
            "using System.IO;",
            "using System.Text.RegularExpressions;",
            "using System.Collections.Generic;",
            "",
            "public sealed class AlignmentResult",
            "{",
            "    public double Dx;",
            "    public double Dy;",
            "    public double Confidence;",
            "    public double PeakZ;",
            "    public int Support;",
            "    public double Margin;",
            "}",
            "",
            "public static class SpriteFirstFrameAligner",
            "{",
            "    private const int MaxAnalysisDimension = 1024;",
            "",
            "    public static void ReportProgress(string path, int completed, int total)",
            "    {",
            "        if (String.IsNullOrEmpty(path)) return;",
            "        try { File.WriteAllText(path, completed + \"|\" + total); }",
            "        catch (IOException) { } // UI can briefly hold the file while reading.",
            "    }",
            "",
            "    public static Rectangle SequenceBounds(string firstPath, int count, string progressPath, int completedBase, int total)",
            "    {",
            "        count = Math.Max(1, count);",
            "        string directory = Path.GetDirectoryName(firstPath);",
            "        Match name = Regex.Match(Path.GetFileName(firstPath), @\"^(.*?)(\\d+)(\\.[^.]+)$\");",
            "        if (count > 1 && !name.Success)",
            "            throw new InvalidOperationException(\"Cannot determine sequence filenames.\");",
            "        long first = name.Success ? Int64.Parse(name.Groups[2].Value) : 0;",
            "        Rectangle union = Rectangle.Empty;",
            "        for (int frame = 0; frame < count; frame++)",
            "        {",
            "            ReportProgress(progressPath, completedBase + frame, total);",
            "            string path = frame == 0 ? firstPath : Path.Combine(directory,",
            "                name.Groups[1].Value + (first + frame).ToString(\"D\" + name.Groups[2].Value.Length) + name.Groups[3].Value);",
            "            using (Bitmap original = new Bitmap(path))",
            "            using (Bitmap bitmap = Resize(original, 1.0))",
            "            {",
            "                Rectangle bounds;",
            "                try { bounds = FindAlphaBounds(bitmap); }",
            "                catch (InvalidOperationException) { continue; }",
            "                union = union.IsEmpty ? bounds : Rectangle.Union(union, bounds);",
            "            }",
            "        }",
            "        ReportProgress(progressPath, completedBase + count, total);",
            "        return union;",
            "    }",
            "",
            "    public static AlignmentResult Match(string referencePath, string targetPath)",
            "    {",
            "        using (Bitmap referenceOriginal = new Bitmap(referencePath))",
            "        using (Bitmap targetOriginal = new Bitmap(targetPath))",
            "        using (Bitmap referenceFull = Resize(referenceOriginal, 1.0))",
            "        using (Bitmap targetFull = Resize(targetOriginal, 1.0))",
            "        {",
            "            Rectangle referenceBounds = FindAlphaBounds(referenceFull);",
            "            Rectangle targetBounds = FindAlphaBounds(targetFull);",
            "            using (Bitmap referenceCrop = referenceFull.Clone(referenceBounds, PixelFormat.Format32bppArgb))",
            "            using (Bitmap targetCrop = targetFull.Clone(targetBounds, PixelFormat.Format32bppArgb))",
            "            {",
            "            int maxDimension = Math.Max(",
            "                Math.Max(referenceCrop.Width, referenceCrop.Height),",
            "                Math.Max(targetCrop.Width, targetCrop.Height));",
            "            double scale = maxDimension > MaxAnalysisDimension",
            "                ? (double)MaxAnalysisDimension / maxDimension",
            "                : 1.0;",
            "",
            "            using (Bitmap reference = Resize(referenceCrop, scale))",
            "            using (Bitmap target = Resize(targetCrop, scale))",
            "            {",
            "                // Linear-correlation padding prevents large offsets from wrapping",
            "                // around to the opposite side of the FFT's periodic canvas.",
            "                int width = NextPowerOfTwo(reference.Width + target.Width - 1);",
            "                int height = NextPowerOfTwo(reference.Height + target.Height - 1);",
            "",
            "                var candidates = new List<Point>();",
            "                PhaseCandidates(reference, target, width, height, false, candidates);",
            "                PhaseCandidates(reference, target, width, height, true, candidates);",
            "                // Geometric candidates are proposals only, never unchecked fallbacks.",
            "                candidates.Add(new Point(0, 0));",
            "                candidates.Add(new Point((reference.Width - target.Width) / 2, reference.Height - target.Height));",
            "                int[] refPixels = ReadPixels(reference), targetPixels = ReadPixels(target);",
            "                List<Point> featureOffsets = FeatureCandidates(refPixels, reference.Width, reference.Height,",
            "                    targetPixels, target.Width, target.Height, candidates);",
            "                double best = -1, second = -1, agreement = 0, coverage = 0;",
            "                Point chosen = Point.Empty;",
            "                var evaluated = new List<Point>();",
            "                foreach (Point point in candidates) {",
            "                    if (evaluated.Contains(point)) continue;",
            "                    evaluated.Add(point);",
            "                    double agree, cover;",
            "                    double score = Verify(refPixels, reference.Width, reference.Height,",
            "                        targetPixels, target.Width, target.Height, point.X, point.Y, out agree, out cover);",
            "                    if (score > best) {",
            "                        if (Math.Abs(point.X - chosen.X) + Math.Abs(point.Y - chosen.Y) > 5) second = best;",
            "                        best = score; chosen = point; agreement = agree; coverage = cover;",
            "                    } else if (Math.Abs(point.X - chosen.X) + Math.Abs(point.Y - chosen.Y) > 5 && score > second) second = score;",
            "                }",
            "                // Recover one-pixel precision around a phase candidate.",
            "                Point initial = chosen;",
            "                for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {",
            "                    double agree, cover;",
            "                    double score = Verify(refPixels, reference.Width, reference.Height,",
            "                        targetPixels, target.Width, target.Height, initial.X + dx, initial.Y + dy, out agree, out cover);",
            "                    if (score > best) {",
            "                        best = score; chosen = new Point(initial.X + dx, initial.Y + dy);",
            "                        agreement = agree; coverage = cover;",
            "                    }",
            "                }",
            "                // Independent RGB/neighborhood agreement rejects silhouette-only false peaks.",
            "                second = -1;",
            "                foreach (Point point in evaluated) {",
            "                    if (Math.Abs(point.X - chosen.X) + Math.Abs(point.Y - chosen.Y) <= 5) continue;",
            "                    double ignoredAgreement, ignoredCoverage;",
            "                    double other = Verify(refPixels, reference.Width, reference.Height,",
            "                        targetPixels, target.Width, target.Height, point.X, point.Y, out ignoredAgreement, out ignoredCoverage);",
            "                    if (other > second) second = other;",
            "                }",
            "                int support = FeatureSupport(featureOffsets, chosen);",
            "                bool reliable = coverage >= 0.35 && (second < best * 0.94 || best > 0.65) &&",
            "                    ((agreement >= 0.32 && best >= 0.23) ||",
            "                     (agreement >= 0.15 && best >= 0.14 && support >= 8));",
            "                return new AlignmentResult {",
            "                    Dx = Math.Round(chosen.X / scale) + referenceBounds.X - targetBounds.X,",
            "                    Dy = Math.Round(chosen.Y / scale) + referenceBounds.Y - targetBounds.Y,",
            "                    Confidence = reliable ? Math.Min(1, best) : 0,",
            "                    PeakZ = agreement, Support = support, Margin = best - second",
            "                };",
            "            }",
            "            }",
            "        }",
            "    }",
            "",
            "    private sealed class Feature {",
            "        public int X, Y;",
            "        public double Strength;",
            "        public int[] Patch;",
            "    }",
            "",
            "    private static List<Feature> Features(int[] pixels, int width, int height) {",
            "        var result = new List<Feature>();",
            "        for (int top = 3; top < height - 3; top += 10) for (int left = 3; left < width - 3; left += 10) {",
            "            Feature best = null;",
            "            for (int y = top; y < Math.Min(top + 10, height - 3); y++)",
            "                for (int x = left; x < Math.Min(left + 10, width - 3); x++) {",
            "                    int p = y * width + x;",
            "                    if ((uint)pixels[p] >> 24 < 200) continue;",
            "                    double gx = ColorDistance(pixels[p - 1], pixels[p + 1]);",
            "                    double gy = ColorDistance(pixels[p - width], pixels[p + width]);",
            "                    double strength = Math.Min(gx, gy);",
            "                    if (strength < 40 || (best != null && strength <= best.Strength)) continue;",
            "                    var patch = new int[9];",
            "                    int index = 0;",
            "                    bool valid = true;",
            "                    for (int dy = -2; dy <= 2; dy += 2) for (int dx = -2; dx <= 2; dx += 2) {",
            "                        int sample = pixels[(y + dy) * width + x + dx];",
            "                        if ((uint)sample >> 24 < 200) valid = false;",
            "                        patch[index++] = sample;",
            "                    }",
            "                    if (valid) best = new Feature {X=x, Y=y, Strength=strength, Patch=patch};",
            "                }",
            "            if (best != null) result.Add(best);",
            "        }",
            "        result.Sort(delegate(Feature a, Feature b) {return b.Strength.CompareTo(a.Strength);});",
            "        if (result.Count > 1000) result.RemoveRange(1000, result.Count - 1000);",
            "        return result;",
            "    }",
            "",
            "    private static int FeatureSupport(List<Point> offsets, Point shift) {",
            "        int count = 0;",
            "        foreach (Point point in offsets)",
            "            if (Math.Abs(point.X - shift.X) <= 2 && Math.Abs(point.Y - shift.Y) <= 2) count++;",
            "        return count;",
            "    }",
            "",
            "    private static List<Point> FeatureCandidates(int[] a, int aw, int ah, int[] b, int bw, int bh, List<Point> candidates) {",
            "        List<Feature> refs = Features(a, aw, ah), targets = Features(b, bw, bh);",
            "        var offsets = new List<Point>();",
            "        foreach (Feature target in targets) {",
            "            double best = Double.MaxValue, second = Double.MaxValue;",
            "            Feature chosen = null;",
            "            foreach (Feature reference in refs) {",
            "                if (ColorDistance(reference.Patch[4], target.Patch[4]) > 100) continue;",
            "                double distance = 0;",
            "                for (int i = 0; i < 9; i++) distance += ColorDistance(reference.Patch[i], target.Patch[i]);",
            "                if (distance < best) {second = best; best = distance; chosen = reference;}",
            "                else if (distance < second) second = distance;",
            "            }",
            "            // Ambiguous repeated ornaments must not contribute votes.",
            "            if (chosen != null && best <= 540 && second < Double.MaxValue && best < second * 0.65)",
            "                offsets.Add(new Point(chosen.X - target.X, chosen.Y - target.Y));",
            "        }",
            "        var histogram = new Dictionary<Point, int>();",
            "        foreach (Point point in offsets) {",
            "            Point bin = new Point((int)Math.Floor(point.X / 4.0), (int)Math.Floor(point.Y / 4.0));",
            "            histogram[bin] = histogram.ContainsKey(bin) ? histogram[bin] + 1 : 1;",
            "        }",
            "        var ranked = new List<KeyValuePair<Point, int>>(histogram);",
            "        ranked.Sort(delegate(KeyValuePair<Point, int> x, KeyValuePair<Point, int> y) {return y.Value.CompareTo(x.Value);});",
            "        for (int i = 0; i < Math.Min(8, ranked.Count); i++) {",
            "            int sumX = 0, sumY = 0, count = 0;",
            "            Point bin = ranked[i].Key;",
            "            foreach (Point point in offsets) {",
            "                if ((int)Math.Floor(point.X / 4.0) != bin.X || (int)Math.Floor(point.Y / 4.0) != bin.Y) continue;",
            "                sumX += point.X; sumY += point.Y; count++;",
            "            }",
            "            candidates.Add(new Point((int)Math.Round((double)sumX / count), (int)Math.Round((double)sumY / count)));",
            "        }",
            "        return offsets;",
            "    }",
            "",
            "    private static void PhaseCandidates(Bitmap reference, Bitmap target, int width, int height, bool texture, List<Point> candidates)",
            "    {",
            "        Complex[] a = BuildSignal(reference, width, height, texture);",
            "        Complex[] b = BuildSignal(target, width, height, texture);",
            "        Transform2D(a, width, height, false);",
            "        Transform2D(b, width, height, false);",
            "        for (int i = 0; i < a.Length; i++) {",
            "            Complex cross = Complex.Conjugate(b[i]) * a[i];",
            "            a[i] = cross.Magnitude > 1e-12 ? cross / cross.Magnitude : Complex.Zero;",
            "        }",
            "        Transform2D(a, width, height, true);",
            "        var peaks = new List<KeyValuePair<double, Point>>();",
            "        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {",
            "            int sx = x > width / 2 ? x - width : x;",
            "            int sy = y > height / 2 ? y - height : y;",
            "            if (sx <= -target.Width || sx >= reference.Width || sy <= -target.Height || sy >= reference.Height) continue;",
            "            double value = a[y * width + x].Real;",
            "            if (peaks.Count == 16 && value <= peaks[15].Key) continue;",
            "            if (value < a[y * width + (x + width - 1) % width].Real ||",
            "                value < a[y * width + (x + 1) % width].Real ||",
            "                value < a[((y + height - 1) % height) * width + x].Real ||",
            "                value < a[((y + 1) % height) * width + x].Real) continue;",
            "            int pos = 0;",
            "            while (pos < peaks.Count && peaks[pos].Key > value) pos++;",
            "            peaks.Insert(pos, new KeyValuePair<double, Point>(value, new Point(sx, sy)));",
            "            if (peaks.Count > 16) peaks.RemoveAt(16);",
            "        }",
            "        foreach (var peak in peaks) candidates.Add(peak.Value);",
            "    }",
            "",
            "    private static int[] ReadPixels(Bitmap bitmap)",
            "    {",
            "        BitmapData data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height),",
            "            ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);",
            "        try {",
            "            int stride = Math.Abs(data.Stride);",
            "            byte[] bytes = new byte[stride * bitmap.Height];",
            "            Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);",
            "            int[] pixels = new int[bitmap.Width * bitmap.Height];",
            "            for (int y = 0; y < bitmap.Height; y++) for (int x = 0; x < bitmap.Width; x++) {",
            "                int row = (data.Stride >= 0 ? y : bitmap.Height - 1 - y) * stride;",
            "                int p = row + x * 4;",
            "                pixels[y * bitmap.Width + x] = bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16 | bytes[p + 3] << 24;",
            "            }",
            "            return pixels;",
            "        } finally { bitmap.UnlockBits(data); }",
            "    }",
            "",
            "    private static double ColorDistance(int a, int b)",
            "    {",
            "        return Math.Abs((a & 255) - (b & 255)) +",
            "            Math.Abs(((a >> 8) & 255) - ((b >> 8) & 255)) +",
            "            Math.Abs(((a >> 16) & 255) - ((b >> 16) & 255));",
            "    }",
            "",
            "    private static double Verify(int[] a, int aw, int ah, int[] b, int bw, int bh,",
            "        int dx, int dy, out double agreement, out double coverage)",
            "    {",
            "        double opaqueA = 0, opaqueB = 0, overlap = 0, matches = 0;",
            "        for (int y = 1; y < ah - 1; y += 2) for (int x = 1; x < aw - 1; x += 2)",
            "            if ((uint)a[y * aw + x] >> 24 >= 128) opaqueA++;",
            "        for (int y = 1; y < bh - 1; y += 2) for (int x = 1; x < bw - 1; x += 2) {",
            "            int bp = y * bw + x;",
            "            if ((uint)b[bp] >> 24 < 128) continue;",
            "            opaqueB++;",
            "            int rx = x + dx, ry = y + dy;",
            "            if (rx < 1 || ry < 1 || rx >= aw - 1 || ry >= ah - 1) continue;",
            "            int ap = ry * aw + rx;",
            "            if ((uint)a[ap] >> 24 < 128) continue;",
            "            overlap++;",
            "            // Three neighboring color samples discriminate shared details from flat-color coincidence.",
            "            double distance = ColorDistance(a[ap], b[bp]);",
            "            double neighborhood = ColorDistance(a[ap - 1], b[bp - 1]) + ColorDistance(a[ap + aw], b[bp + bw]);",
            "            if (distance <= 90 && neighborhood <= 200) matches++;",
            "        }",
            "        coverage = overlap / Math.Max(1, Math.Min(opaqueA, opaqueB));",
            "        agreement = matches / Math.Max(1, overlap);",
            "        if (matches < 32) return 0;",
            "        return agreement * Math.Sqrt(Math.Min(1, coverage));",
            "    }",
            "",
            "    private static Rectangle FindAlphaBounds(Bitmap bitmap)",
            "    {",
            "        double[] alpha = ReadAlpha(bitmap);",
            "        int minX = bitmap.Width;",
            "        int minY = bitmap.Height;",
            "        int maxX = -1;",
            "        int maxY = -1;",
            "        for (int y = 0; y < bitmap.Height; y++)",
            "        {",
            "            int row = y * bitmap.Width;",
            "            for (int x = 0; x < bitmap.Width; x++)",
            "            {",
            "                if (alpha[row + x] < 8.0 / 255.0) continue;",
            "                minX = Math.Min(minX, x);",
            "                minY = Math.Min(minY, y);",
            "                maxX = Math.Max(maxX, x);",
            "                maxY = Math.Max(maxY, y);",
            "            }",
            "        }",
            "        if (maxX < 0) throw new InvalidOperationException(\"First frame is fully transparent; alignment is undefined.\");",
            "        return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);",
            "    }",
            "",
            "    private static Bitmap Resize(Bitmap source, double scale)",
            "    {",
            "        if (scale >= 0.999999)",
            "        {",
            "            Bitmap copy = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);",
            "            using (Graphics graphics = Graphics.FromImage(copy))",
            "            {",
            "                graphics.CompositingMode = CompositingMode.SourceCopy;",
            "                graphics.DrawImageUnscaled(source, 0, 0);",
            "            }",
            "            return copy;",
            "        }",
            "",
            "        int width = Math.Max(1, (int)Math.Round(source.Width * scale));",
            "        int height = Math.Max(1, (int)Math.Round(source.Height * scale));",
            "        Bitmap resized = new Bitmap(width, height, PixelFormat.Format32bppArgb);",
            "        using (Graphics graphics = Graphics.FromImage(resized))",
            "        {",
            "            graphics.CompositingMode = CompositingMode.SourceCopy;",
            "            graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;",
            "            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;",
            "            graphics.DrawImage(source, new Rectangle(0, 0, width, height));",
            "        }",
            "        return resized;",
            "    }",
            "",
            "    private static Complex[] BuildSignal(Bitmap bitmap, int paddedWidth, int paddedHeight, bool texture)",
            "    {",
            "        double[] alpha = ReadAlpha(bitmap);",
            "        Complex[] signal = new Complex[paddedWidth * paddedHeight];",
            "",
            "        int[] pixels = texture ? ReadPixels(bitmap) : null;",
            "        // Keep alpha and interior texture as separate hypotheses; effects must not dominate both.",
            "        for (int y = 0; y < bitmap.Height; y++)",
            "        {",
            "            int srcRow = y * bitmap.Width;",
            "            int dstRow = y * paddedWidth;",
            "            for (int x = 0; x < bitmap.Width; x++)",
            "            {",
            "                double center = alpha[srcRow + x];",
            "                double left = x > 0 ? alpha[srcRow + x - 1] : 0.0;",
            "                double up = y > 0 ? alpha[srcRow - bitmap.Width + x] : 0.0;",
            "                double edge = Math.Abs(center - left) + Math.Abs(center - up);",
            "                double value = center + edge * 0.65;",
            "                if (texture) {",
            "                    int pixel = pixels[srcRow + x];",
            "                    double gx = x > 0 && left > 0.5 ? ColorDistance(pixel, pixels[srcRow + x - 1]) / 765.0 : 0;",
            "                    double gy = y > 0 && up > 0.5 ? ColorDistance(pixel, pixels[srcRow + x - bitmap.Width]) / 765.0 : 0;",
            "                    value = center > 0.5 ? (gx + gy) * 4.0 : 0;",
            "                }",
            "                signal[dstRow + x] = new Complex(value, 0.0);",
            "            }",
            "        }",
            "        return signal;",
            "    }",
            "",
            "    private static double[] ReadAlpha(Bitmap bitmap)",
            "    {",
            "        Rectangle rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);",
            "        BitmapData data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);",
            "        try",
            "        {",
            "            int stride = Math.Abs(data.Stride);",
            "            byte[] bytes = new byte[stride * bitmap.Height];",
            "            Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);",
            "            double[] alpha = new double[bitmap.Width * bitmap.Height];",
            "            for (int y = 0; y < bitmap.Height; y++)",
            "            {",
            "                int sourceY = data.Stride >= 0 ? y : bitmap.Height - 1 - y;",
            "                int row = sourceY * stride;",
            "                int targetRow = y * bitmap.Width;",
            "                for (int x = 0; x < bitmap.Width; x++)",
            "                {",
            "                    alpha[targetRow + x] = bytes[row + x * 4 + 3] / 255.0;",
            "                }",
            "            }",
            "            return alpha;",
            "        }",
            "        finally",
            "        {",
            "            bitmap.UnlockBits(data);",
            "        }",
            "    }",
            "",
            "    private static int NextPowerOfTwo(int value)",
            "    {",
            "        int result = 1;",
            "        while (result < value) result <<= 1;",
            "        return result;",
            "    }",
            "",
            "    private static void Transform2D(Complex[] values, int width, int height, bool inverse)",
            "    {",
            "        Complex[] buffer = new Complex[Math.Max(width, height)];",
            "",
            "        for (int y = 0; y < height; y++)",
            "        {",
            "            int row = y * width;",
            "            Array.Copy(values, row, buffer, 0, width);",
            "            Transform1D(buffer, width, inverse);",
            "            Array.Copy(buffer, 0, values, row, width);",
            "        }",
            "",
            "        for (int x = 0; x < width; x++)",
            "        {",
            "            for (int y = 0; y < height; y++) buffer[y] = values[y * width + x];",
            "            Transform1D(buffer, height, inverse);",
            "            for (int y = 0; y < height; y++) values[y * width + x] = buffer[y];",
            "        }",
            "    }",
            "",
            "    private static void Transform1D(Complex[] values, int length, bool inverse)",
            "    {",
            "        int j = 0;",
            "        for (int i = 1; i < length; i++)",
            "        {",
            "            int bit = length >> 1;",
            "            while ((j & bit) != 0)",
            "            {",
            "                j ^= bit;",
            "                bit >>= 1;",
            "            }",
            "            j ^= bit;",
            "            if (i < j)",
            "            {",
            "                Complex temp = values[i];",
            "                values[i] = values[j];",
            "                values[j] = temp;",
            "            }",
            "        }",
            "",
            "        for (int block = 2; block <= length; block <<= 1)",
            "        {",
            "            double angle = (inverse ? 2.0 : -2.0) * Math.PI / block;",
            "            Complex step = new Complex(Math.Cos(angle), Math.Sin(angle));",
            "            int half = block >> 1;",
            "            for (int start = 0; start < length; start += block)",
            "            {",
            "                Complex factor = Complex.One;",
            "                for (int k = 0; k < half; k++)",
            "                {",
            "                    Complex even = values[start + k];",
            "                    Complex odd = values[start + k + half] * factor;",
            "                    values[start + k] = even + odd;",
            "                    values[start + k + half] = even - odd;",
            "                    factor *= step;",
            "                }",
            "            }",
            "        }",
            "",
            "        if (inverse)",
            "        {",
            "            for (int i = 0; i < length; i++) values[i] /= length;",
            "        }",
            "    }",
            "}",
            "'@",
            "",
            "$resultLines = New-Object 'System.Collections.Generic.List[string]'",
            "try {",
            "    Add-Type -TypeDefinition $source -ReferencedAssemblies @(",
            "        \"System.Drawing\",",
            "        \"System.Numerics\"",
            "    )",
            "}",
            "catch {",
            "    $resultLines.Add(\"ERROR|-1|\" + $_.Exception.Message.Replace(\"`r\", \" \").Replace(\"`n\", \" \"))",
            "    if ($OutputPath) {",
            "        [System.IO.File]::WriteAllLines($OutputPath, $resultLines.ToArray(), [System.Text.Encoding]::UTF8)",
            "    }",
            "    else { $resultLines | ForEach-Object { [Console]::WriteLine($_) } }",
            "    exit 1",
            "}",
            "",
            "$Targets = $TargetList.Split([char]'|')",
            "$counts = $FrameCounts.Split([char]',')",
            "$boundsCache = @{}",
            "$alignmentResults = @{}",
            "$alignmentRows = @{}",
            "$completedFrames = 0",
            "$totalFrames = 0",
            "if ($BoundsOnly) {",
            "    foreach ($value in $counts) { $totalFrames += if ($value) { [Math]::Max(1, [int]$value) } else { 1 } }",
            "}",
            "else { $totalFrames = $Targets.Count * 2 }",
            "[SpriteFirstFrameAligner]::ReportProgress($ProgressPath, 0, $totalFrames)",
            "",
            "for ($index = 0; $index -lt $Targets.Count; $index++) {",
            "    try {",
            "        if ($BoundsOnly) {",
            "            $count = if ($index -lt $counts.Count -and $counts[$index]) { [int]$counts[$index] } else { 1 }",
            "            $key = $Targets[$index] + \"|\" + $count",
            "            if (-not $boundsCache.ContainsKey($key)) {",
            "                $boundsCache[$key] = [SpriteFirstFrameAligner]::SequenceBounds($Targets[$index], $count, $ProgressPath, $completedFrames, $totalFrames)",
            "            }",
            "            $bounds = $boundsCache[$key]",
            "            $resultLines.Add(\"BOUNDS|\" + $index + \"|\" + $bounds.X + \"|\" + $bounds.Y + \"|\" + $bounds.Width + \"|\" + $bounds.Height)",
            "            $completedFrames += $count",
            "            [SpriteFirstFrameAligner]::ReportProgress($ProgressPath, $completedFrames, $totalFrames)",
            "            continue",
            "        }",
            "        $result = [SpriteFirstFrameAligner]::Match($Reference, $Targets[$index])",
            "        $alignmentResults[$index] = $result",
            "        $alignmentRows[$index] = $resultLines.Count",
            "        $resultLines.Add([string]::Format(",
            "            [System.Globalization.CultureInfo]::InvariantCulture,",
            "            \"ALIGN|{0}|{1:R}|{2:R}|{3:R}|{4:R}|{5}|{6:R}\",",
            "            @($index, $result.Dx, $result.Dy, $result.Confidence, $result.PeakZ, $result.Support, $result.Margin)",
            "        ))",
            "    }",
            "    catch {",
            "        $message = $_.Exception.Message.Replace(\"`r\", \" \").Replace(\"`n\", \" \").Replace(\"|\", \"/\")",
            "        $resultLines.Add(\"ERROR|\" + $index + \"|\" + $message)",
            "        if ($BoundsOnly) { $completedFrames += [Math]::Max(1, $count) }",
            "    }",
            "    [SpriteFirstFrameAligner]::ReportProgress($ProgressPath, $(if ($BoundsOnly) { $completedFrames } else { $index + 1 }), $totalFrames)",
            "}",
            "",
            "# For weak direct matches, use only independently verified direct anchors.",
            "# Require agreement from at least two paths; never propagate a chain of guesses.",
            "if (-not $BoundsOnly) {",
            "    $anchors = @()",
            "    for ($anchorIndex = 0; $anchorIndex -lt $Targets.Count; $anchorIndex++) {",
            "        if ($alignmentResults.ContainsKey($anchorIndex) -and",
            "            $alignmentResults[$anchorIndex].Confidence -ge 0.23 -and $Targets[$anchorIndex] -ne $Reference) {",
            "            $anchors += $anchorIndex",
            "        }",
            "    }",
            "    for ($index = 0; $index -lt $Targets.Count; $index++) {",
            "        [SpriteFirstFrameAligner]::ReportProgress($ProgressPath, $Targets.Count + $index, $totalFrames)",
            "        if (-not $alignmentResults.ContainsKey($index) -or $alignmentResults[$index].Confidence -ge 0.15) { continue }",
            "        $hypotheses = @()",
            "        foreach ($anchorIndex in @($anchors | Select-Object -First 6)) {",
            "            try {",
            "                $link = [SpriteFirstFrameAligner]::Match($Targets[$anchorIndex], $Targets[$index])",
            "                if ($link.Confidence -lt 0.15) { continue }",
            "                $anchor = $alignmentResults[$anchorIndex]",
            "                $hypotheses += [pscustomobject]@{",
            "                    Dx = $anchor.Dx + $link.Dx",
            "                    Dy = $anchor.Dy + $link.Dy",
            "                    Confidence = [Math]::Min($anchor.Confidence, $link.Confidence)",
            "                    Agreement = $link.PeakZ",
            "                    Support = $link.Support",
            "                    Margin = $link.Margin",
            "                }",
            "            } catch { } # A failed intermediate comparison cannot invalidate direct matches.",
            "        }",
            "        $bestCluster = @()",
            "        foreach ($proposal in $hypotheses) {",
            "            $cluster = @($hypotheses | Where-Object {",
            "                [Math]::Abs($_.Dx - $proposal.Dx) -le 4 -and [Math]::Abs($_.Dy - $proposal.Dy) -le 4",
            "            })",
            "            if ($cluster.Count -gt $bestCluster.Count) { $bestCluster = $cluster }",
            "        }",
            "        if ($bestCluster.Count -lt 2) { continue }",
            "        $mid = [int][Math]::Floor($bestCluster.Count / 2)",
            "        $dx = @($bestCluster | Sort-Object Dx)[$mid].Dx",
            "        $dy = @($bestCluster | Sort-Object Dy)[$mid].Dy",
            "        $quality = @($bestCluster | Sort-Object Confidence)[0]",
            "        $resultLines[$alignmentRows[$index]] = [string]::Format(",
            "            [System.Globalization.CultureInfo]::InvariantCulture,",
            "            \"ALIGN|{0}|{1:R}|{2:R}|{3:R}|{4:R}|{5}|{6:R}|CONSENSUS\",",
            "            @($index, $dx, $dy, $quality.Confidence, $quality.Agreement, $quality.Support, $quality.Margin))",
            "    }",
            "    [SpriteFirstFrameAligner]::ReportProgress($ProgressPath, $totalFrames, $totalFrames)",
            "}",
            "",
            "if ($OutputPath) {",
            "    [System.IO.File]::WriteAllLines($OutputPath, $resultLines.ToArray(), [System.Text.Encoding]::UTF8)",
            "}",
            "else {",
            "    $resultLines | ForEach-Object { [Console]::WriteLine($_) }",
            "}",
            ""
        ].join("\n");
        file.encoding = "UTF-8";
        if (!file.open("w")) throw new Error("无法创建智能对齐临时程序：" + file.fsName);
        try {
            // UTF-8 BOM lets Windows PowerShell 5 read Chinese source correctly.
            file.write("\uFEFF" + source);
        } finally { file.close(); }
        return file;
    }

// Action switching and portable project presets. Shared by both language panels.
function createPresetUtils() {
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
    function isDropdownEffect(effect) {
        if (!effect) return false;
        try { if (effect.property(1).isDropdownEffect === true) return true; } catch (e) {}
        return effect.matchName === "ADBE Dropdown Control";
    }
    function dropdown(layer) {
        var effects = layer.property("ADBE Effect Parade"), found = null;
        var remap = layer.property("ADBE Time Remapping");
        var reference = remap && /var\s+menu\s*=\s*effect\("((?:\\.|[^"\\])*)"\)/.exec(remap.expression);
        var referencedName = reference ? reference[1].replace(/\\(["\\])/g, "$1") : null;
        if (effects) for (var i = 1; i <= effects.numProperties; i++) {
            var effect = effects.property(i);
            // Custom menu parameters can change the effect matchName to Pseudo/...
            if (referencedName && effect.name === referencedName) {
                if (!isDropdownEffect(effect)) {
                    var menu = effect.property(1);
                    if (!menu || menu.isDropdownEffect === false || !/^Pseudo\//.test(effect.matchName) ||
                            !/^(Menu|菜单)$/.test(menu.name))
                        throw new Error("表达式引用的控件不是动作下拉菜单：" + referencedName);
                }
                return effect;
            }
            if (isDropdownEffect(effect)) {
                if (found) found = false;
                else if (found !== false) found = effect;
            }
        }
        if (referencedName) throw new Error("找不到表达式引用的动作菜单：" + referencedName + "。请检查控件是否被删除或改名。");
        if (found === false) throw new Error("目标有多个下拉菜单，无法确定动作菜单。");
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
        app.beginUndoGroup("切换动作并标记起止");
        var startCollision = false;
        try {
            menu.setValueAtTime(time, index + 1);
            var key = menu.nearestKeyIndex(time);
            menu.setInterpolationTypeAtKey(key, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            for (var k = markers.numKeys; k >= 1; k--)
                if (markers.keyValue(k).comment.indexOf(markerPrefix) === 0) markers.removeKey(k);
            // Keep the history of action starts. Only replace our own start at the same time.
            for (var k = 1; k <= markers.numKeys; k++) {
                if (Math.abs(markers.keyTime(k) - time) < 0.00001) {
                    var existing = markers.keyValue(k);
                    var parameters = existing.getParameters();
                    if (parameters.SequenceActionerStart !== "1") startCollision = true;
                }
            }
            if (!startCollision) {
                var start = new MarkerValue(action.name);
                // Label 0 is the neutral white/default marker, not a colored label.
                try { start.label = 0; } catch (e) {}
                start.setParameters({SequenceActionerStart: "1"});
                markers.setValueAtTime(time, start);
            }
            if (!action.loop && !collision) {
                var marker = new MarkerValue(markerPrefix + action.name + " · 播放结束");
                try { marker.label = 1; } catch (e) {}
                markers.setValueAtTime(end, marker);
            }
        } finally { app.endUndoGroup(); }
        return "已切换：" + action.name + (action.loop ? "（循环）" :
            " · 结束 " + end.toFixed(3) + " 秒" + (collision ? "（已有手动标记，未覆盖）" : "")) +
            (startCollision ? "\n开始点已有手动标记，未覆盖。" : "") +
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
            if (p[0] === "PROJECT") data.projectName = decodeURIComponent(p[1]);
            if (p[0] === "ACTION") data.rows.push({name: decodeURIComponent(p[1]), frames: p[2], loop: p[3] === "1"});
            if (p[0] === "MEDIA") data.footage.push({tag: p[1], path: decodeURIComponent(p[2]), sequence: p[3] === "1"});
        }
        if (!data.name || !/^SA_\d+_\d+$/.test(data.token) || !data.rows.length || data.rows.length > 64 || !(data.fps > 0))
            throw new Error("预设信息不完整。");
        if (data.projectName && (!/\.aep$/i.test(data.projectName) ||
                /[\\\/:*?"<>|\x00-\x1F]/.test(data.projectName) || /^\./.test(data.projectName)))
            throw new Error("预设工程文件名无效。");
        return data;
    }
    function presetProjectName(name) {
        var safe = name.replace(/[\\\/:*?"<>|\x00-\x1F]/g, "_").replace(/^[ .]+|[ .]+$/g, "");
        if (/\.aep$/i.test(safe)) safe = safe.substring(0, safe.length - 4).replace(/[ .]+$/g, "");
        if (!safe || /^\.+$/.test(safe)) safe = "预设";
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe)) safe = "_" + safe;
        // Keep paths manageable; manifest still preserves the full display name.
        if (safe.length > 80) safe = safe.substring(0, 80);
        return safe + ".aep";
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
        var projectName = presetProjectName(name);
        var project = new File(pack.fsName + "/" + projectName);
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
                "AE|" + encodeURIComponent(app.version), "PROJECT|" + encodeURIComponent(projectName)];
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
        var project = new File(pack.fsName + "/" + (data.projectName || "project.aep"));
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
            var target = root.layer(1);
            // Localize the imported menu-bearing layer even for project-only import.
            localize(target, data.rows, dropdown(target).name);
            if (destination instanceof CompItem) {
                target.copyToComp(destination);
                target = destination.layer(1);
                destination.openInViewer();
                for (var i = 1; i <= destination.numLayers; i++) destination.layer(i).selected = false;
                target.selected = true;
                onLoaded(data.rows, target);
                return "已添加预设：" + data.name + " → " + destination.name +
                    (Math.abs(destination.frameRate - data.fps) >= 0.001 ?
                        "\n当前合成帧率与预设不同，动作播放按当前合成帧率计算。" : "");
            }
            // No destination means import only. Do not open a viewer, select timeline
            // layers or replace the action page's current target.
            return "已导入预设到当前工程：" + data.name;
        } finally { app.endUndoGroup(); }
    }
    function createUI(tab, getContext, localize, onLoaded, restored, report, isBusy) {
        tab.orientation = "column";
        tab.alignChildren = ["fill", "top"];
        tab.margins = 12;
        tab.spacing = 10;
        var header = tab.add("group");
        header.alignment = ["fill", "top"];
        var libraryTitle = header.add("statictext", undefined, "我的预设");
        libraryTitle.alignment = ["fill", "center"];
        var refresh = header.add("button", undefined, "刷新列表");
        var pathGroup = tab.add("group");
        pathGroup.alignment = ["fill", "top"];
        var pathText = pathGroup.add("statictext", [0, 0, 245, 24], "");
        pathText.alignment = ["fill", "center"];
        var choose = pathGroup.add("button", undefined, "选择预设目录");
        var folder = new Folder(Folder.userData.fsName + "/SequenceActioner/Presets");
        if (app.settings.haveSetting("SequenceActioner", "presetFolder"))
            folder = new Folder(app.settings.getSetting("SequenceActioner", "presetFolder"));
        var parent = new Folder(Folder.userData.fsName + "/SequenceActioner");
        if (!parent.exists) parent.create();
        if (!folder.exists) folder.create();
        var list = tab.add("listbox", [0, 0, 390, 190], [], {
            numberOfColumns: 3, showHeaders: true,
            columnTitles: ["预设名称", "动作数", "帧率"],
            columnWidths: [235, 65, 70]
        });
        list.alignment = ["fill", "top"];
        list.helpTip = "双击预设加载。存在当前合成时添加图层，否则只导入当前工程。";
        var savePanel = tab.add("panel", undefined, "保存当前配置");
        savePanel.alignChildren = ["fill", "top"];
        savePanel.margins = 10;
        var nameRow = savePanel.add("group");
        nameRow.alignment = ["fill", "top"];
        nameRow.add("statictext", undefined, "名称");
        var name = nameRow.add("edittext", [0, 0, 245, 24], "");
        name.alignment = ["fill", "center"];
        name.helpTip = "输入便于识别的角色或动作组名称。";
        var save = savePanel.add("button", undefined, "保存选中图层");
        tab.add("statictext", [0, 0, 390, 36],
            "包含工程、动作配置与素材副本。\n移动或分享时，请复制整个预设文件夹。", {multiline: true});
        function reload() {
            var previous = list.selection ? list.selection.presetFile.fsName : "";
            list.removeAll();
            list.selection = null;
            pathText.text = folder.fsName;
            pathText.helpTip = folder.fsName;
            var folders = folder.getFiles(function(f) { return f instanceof Folder; });
            var entries = [];
            for (var i = 0; i < folders.length; i++) {
                var file = new File(folders[i].fsName + "/preset.txt");
                if (!file.exists) continue;
                try { entries.push({file: file, data: manifest(file)}); } catch (e) {}
            }
            entries.sort(function(a, b) {
                return Number(b.data.token.split("_")[1]) - Number(a.data.token.split("_")[1]);
            });
            for (var i = 0; i < entries.length; i++) {
                var data = entries[i].data, row = list.add("item", data.name);
                row.subItems[0].text = String(data.rows.length);
                row.subItems[1].text = String(Math.round(data.fps * 1000) / 1000);
                row.presetFile = entries[i].file;
                row.presetData = data;
                if (row.presetFile.fsName === previous) list.selection = row;
            }
            libraryTitle.text = "我的预设 · " + entries.length + " 个";
            list.helpTip = entries.length ?
                "双击预设加载。存在当前合成时添加图层，否则只导入当前工程。" :
                "还没有预设。选中配置好的序列帧合成图层，填写名称后保存。";
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
                save.enabled = list.enabled = false;
                report("正在保存预设并复制素材…");
                if (savePreset(folder, presetName, context, restored)) { reload(); report("已保存预设：" + presetName); }
            } catch (e) { alert("保存预设失败：\n" + e.toString()); }
            finally { save.enabled = list.enabled = true; }
        };
        list.onDoubleClick = function() {
            try {
                if (isBusy && isBusy()) throw new Error("智能对齐正在执行，请等待完成。");
                if (!list.selection) throw new Error("请选择预设。");
                report(loadPreset(list.selection.presetFile, app.project.activeItem, localize, onLoaded));
            } catch (e) { alert("加载预设失败：\n" + e.toString()); }
        };
        reload();
    }
    return {actions: actions, switchAction: switchAction, createUI: createUI, isDropdownEffect: isDropdownEffect};
}

// Companion utilities: hidden analysis process and fixed source-canvas bounds.
function createLayoutUtils() {
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
            var files = [launcher, doneFile, options.progressFile, options.workerFile];
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
                    if (!receivedProgress && options.onWaiting) options.onWaiting(elapsed);
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
}

    // ================================================
    // 显示窗口
    // ================================================
    function collectButtons(container, buttons) {
        var children = container.children;
        if (!children) return;
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child.type === "button") buttons.push(child);
            else collectButtons(child, buttons);
        }
    }
    function setUniformButtonWidths(container) {
        var buttons = [], width = 120;
        collectButtons(container, buttons);
        // Include the directory label and sufficient padding, using the actual UI font.
        // Longer labels must also fit without changing the shared width.
        for (var i = 0; i < buttons.length; i++) {
            try {
                var measured = buttons[i].graphics.measureString(buttons[i].text);
                width = Math.max(width, Math.ceil(measured[0]) + 24);
            } catch (e) {}
        }
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i], height = button.size.height;
            if (!(height > 0)) height = 24;
            var buttonWidth = width;
            if (button.text === "切换") {
                buttonWidth = 40;
                try { buttonWidth = Math.ceil(button.graphics.measureString("切换")[0]) + 16; } catch (e) {}
            }
            button.alignment = ["left", "center"];
            button.minimumSize = [buttonWidth, height];
            button.maximumSize = [buttonWidth, height];
            button.preferredSize = [buttonWidth, height];
            button.size = [buttonWidth, height];
            button.helpTip = button.helpTip || button.text;
        }
        var switchSize = actionRows[0].switchButton.preferredSize;
        var switchWidth = switchSize.width || switchSize[0];
        switchHeader.minimumSize = [switchWidth, 20];
        switchHeader.maximumSize = [switchWidth, 20];
        switchHeader.preferredSize = [switchWidth, 20];
    }
    win.layout.layout(true);
    setUniformButtonWidths(win);
    win.layout.layout(true);
    if (!isDocked) { win.center(); win.show(); }
    else win.layout.resize();
    watchSelection();
})(this);

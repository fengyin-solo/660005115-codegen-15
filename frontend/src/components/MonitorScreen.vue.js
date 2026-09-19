/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { useSignalStore } from '../store/signal';
const store = useSignalStore();
const SLIDE_COUNT = 3;
const slideTitles = ['概览', '频谱 / 瀑布图', '星座图 / 识别'];
const AUTOPLAY_KEY = 'monitor-autoplay';
const AUTOPLAY_INTERVAL = 8000;
const POLL_INTERVAL = 5000;
const autoplay = ref(localStorage.getItem(AUTOPLAY_KEY) !== 'off');
const hovering = ref(false);
const clock = ref('');
// ---- 图表 / 画布引用（v-show 常驻，挂载时即可初始化） ----
const spectrumSmallEl = ref();
const spectrumBigEl = ref();
const constSmallCvs = ref();
const constBigCvs = ref();
const waterSmallCvs = ref();
const waterBigCvs = ref();
let spectrumSmallChart = null;
let spectrumBigChart = null;
let resizeObserver = null;
let pollTimer = null;
let autoTimer = null;
let clockTimer = null;
// ---- 关键读数（与结果区 ModulationResult 保持一致） ----
const mod = computed(() => store.monitorSnapshot?.modulation);
const typeText = computed(() => mod.value?.type || '—');
const confidenceText = computed(() => mod.value ? `${Math.round(mod.value.confidence * 100)}%` : '—');
const symbolRateText = computed(() => mod.value?.symbolRate != null ? `${mod.value.symbolRate.toFixed(0)} Baud` : 'N/A');
const freqOffsetText = computed(() => mod.value?.frequencyOffset != null ? `${mod.value.frequencyOffset} Hz` : 'N/A');
const candidates = computed(() => store.monitorSnapshot?.modulation.candidates ?? []);
const dataTime = computed(() => store.monitorSnapshot?.generatedAt
    ? new Date(store.monitorSnapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })
    : '未知时间');
const statusClass = computed(() => ({
    ok: 'st-ok', stale: 'st-stale', empty: 'st-empty', idle: 'st-idle'
}[store.monitorStatus]));
const statusText = computed(() => ({
    ok: '数据正常', stale: '未取到数据·展示上一屏', empty: '暂无数据', idle: '正在读取…'
}[store.monitorStatus]));
const emptyTitle = computed(() => store.monitorStatus === 'idle' ? '正在读取数据…' : '暂无分析数据');
const emptyDesc = computed(() => store.monitorStatus === 'idle'
    ? '正在从分析服务获取最新读数，请稍候'
    : store.monitorError
        ? `${store.monitorError}。请先在主界面执行一次信号分析，大屏将自动加载结果。`
        : '还没有任何分析结果。请先在主界面执行一次信号分析，大屏将自动加载结果。');
function progressColor(score) {
    if (score > 0.7)
        return '#66bb6a';
    if (score > 0.4)
        return '#ffa726';
    return '#ef5350';
}
// ---- 频谱图（与 SpectrumPlot.vue 相同的数据截取与配置） ----
function buildSpectrumOption() {
    const s = store.monitorSnapshot;
    if (!s)
        return null;
    const { frequencies, magnitudes } = s.spectrum;
    const halfN = Math.floor(frequencies.length / 2);
    const data = [];
    for (let i = 0; i < halfN; i++)
        data.push([frequencies[i], magnitudes[i]]);
    return {
        backgroundColor: 'transparent',
        grid: { left: 60, right: 25, top: 20, bottom: 45 },
        xAxis: { type: 'value', name: '频率 (Hz)', nameLocation: 'middle', nameGap: 28, axisLabel: { color: '#8899aa' } },
        yAxis: { type: 'value', name: '幅度 (dB)', nameLocation: 'middle', nameGap: 45, axisLabel: { color: '#8899aa' } },
        series: [{
                type: 'line', data, symbol: 'none', lineStyle: { color: '#42a5f5', width: 1.5 },
                areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(66,165,245,0.4)' }, { offset: 1, color: 'rgba(66,165,245,0.02)' }]) }
            }],
        animation: false
    };
}
function renderSpectrum() {
    const option = buildSpectrumOption();
    if (!option)
        return;
    spectrumSmallChart?.setOption(option);
    spectrumBigChart?.setOption(option);
}
// ---- 星座图（与 ConstellationPlot.vue 相同的映射与配色，按容器尺寸自适应） ----
function drawConstellation(cvs) {
    if (!cvs)
        return;
    const ctx = cvs.getContext('2d');
    if (!ctx)
        return;
    const rect = cvs.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0)
        return;
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width, H = rect.height;
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1520';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2a3a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    const pts = store.monitorSnapshot?.constellation || [];
    if (pts.length) {
        const scale = Math.min(W, H) * 0.4;
        for (const pt of pts) {
            const x = W / 2 + pt.i * scale, y = H / 2 - pt.q * scale;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#42a5f5';
            ctx.fill();
            ctx.strokeStyle = 'rgba(66,165,245,0.5)';
            ctx.stroke();
        }
    }
    ctx.fillStyle = '#8899aa';
    ctx.font = '10px system-ui';
    ctx.fillText('I →', W - 25, H / 2 - 5);
    ctx.fillText('Q ↑', W / 2 + 5, 14);
}
// ---- 瀑布图（与 WaterfallPlot.vue 相同的逐行归一化与配色） ----
function drawWaterfall(cvs) {
    if (!cvs)
        return;
    const ctx = cvs.getContext('2d');
    if (!ctx)
        return;
    const rect = cvs.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0)
        return;
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width, H = rect.height;
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1520';
    ctx.fillRect(0, 0, W, H);
    const rows = store.monitorSnapshot?.waterfall || [];
    if (!rows.length)
        return;
    const rowH = H / rows.length;
    for (let r = 0; r < rows.length; r++) {
        const vals = rows[r].values, n = vals.length;
        if (!n)
            continue;
        const valsMin = Math.min(...vals), valsMax = Math.max(...vals);
        const vRange = valsMax - valsMin || 1;
        for (let i = 0; i < n; i++) {
            const t = (vals[i] - valsMin) / vRange;
            const rv = Math.round(t * 200);
            const gv = Math.round(t * 100 + (1 - t) * 50);
            const bv = Math.round((1 - t) * 200 + 30);
            ctx.fillStyle = `rgb(${rv},${gv},${bv})`;
            ctx.fillRect(i * W / n, r * rowH, W / n + 1, rowH + 1);
        }
    }
}
function renderAll() {
    renderSpectrum();
    drawConstellation(constSmallCvs.value);
    drawConstellation(constBigCvs.value);
    drawWaterfall(waterSmallCvs.value);
    drawWaterfall(waterBigCvs.value);
}
// ---- 轮播：自动 + 手动；悬停暂停 ----
function goSlide(i) {
    store.setMonitorSlide((i + SLIDE_COUNT) % SLIDE_COUNT);
    restartAuto();
}
function nextSlide() { goSlide(store.monitorSlide + 1); }
function prevSlide() { goSlide(store.monitorSlide - 1); }
function toggleAutoplay() {
    autoplay.value = !autoplay.value;
    localStorage.setItem(AUTOPLAY_KEY, autoplay.value ? 'on' : 'off');
    restartAuto();
}
function restartAuto() {
    if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
    }
    if (autoplay.value && !hovering.value && store.monitorOpen && store.monitorSnapshot) {
        autoTimer = setInterval(() => {
            if (!hovering.value)
                store.setMonitorSlide((store.monitorSlide + 1) % SLIDE_COUNT);
        }, AUTOPLAY_INTERVAL);
    }
}
function updateClock() {
    clock.value = new Date().toLocaleString('zh-CN', { hour12: false });
}
function onKeydown(e) {
    if (!store.monitorOpen)
        return;
    if (e.key === 'Escape')
        store.closeMonitor();
    else if (e.key === 'ArrowRight')
        nextSlide();
    else if (e.key === 'ArrowLeft')
        prevSlide();
}
function ensureCharts() {
    if (!spectrumSmallChart && spectrumSmallEl.value)
        spectrumSmallChart = echarts.init(spectrumSmallEl.value);
    if (!spectrumBigChart && spectrumBigEl.value)
        spectrumBigChart = echarts.init(spectrumBigEl.value);
}
function onSnapshotChange(newVal, oldVal) {
    // 空态 -> 有数据时图表 DOM 才挂载，需等下一帧再初始化与绘制
    requestAnimationFrame(() => { ensureCharts(); renderAll(); });
    // 仅在空态恢复时重启轮播；普通轮询刷新不能重置计时，否则自动轮播永远不翻页
    if (!oldVal && newVal)
        restartAuto();
}
// 快照更新后重绘（成功替换 / 失败保留均会触发；失败时重绘的仍是上一屏数据）
watch(() => store.monitorSnapshot, onSnapshotChange);
watch(() => store.monitorSlide, () => {
    // v-show 切换后让 ECharts 重新适配尺寸
    requestAnimationFrame(() => { spectrumSmallChart?.resize(); spectrumBigChart?.resize(); renderAll(); });
});
watch(hovering, restartAuto);
// 重新打开大屏：停在原来那屏，立即重新读取（失败会自动保留上一屏）
watch(() => store.monitorOpen, (open) => {
    if (open) {
        updateClock();
        requestAnimationFrame(() => {
            ensureCharts();
            spectrumSmallChart?.resize();
            spectrumBigChart?.resize();
            renderAll();
        });
        store.refreshMonitor();
        restartAuto();
    }
    else if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
    }
});
onMounted(() => {
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
    if (store.monitorOpen) {
        ensureCharts();
        renderAll();
        restartAuto();
    }
    resizeObserver = new ResizeObserver(() => {
        if (!store.monitorOpen)
            return;
        spectrumSmallChart?.resize();
        spectrumBigChart?.resize();
        renderAll();
    });
    resizeObserver.observe(document.body);
    // 轮询只读接口（仅大屏打开期间发请求）
    pollTimer = setInterval(() => { if (store.monitorOpen)
        store.refreshMonitor(); }, POLL_INTERVAL);
    window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
    pollTimer && clearInterval(pollTimer);
    autoTimer && clearInterval(autoTimer);
    clockTimer && clearInterval(clockTimer);
    resizeObserver?.disconnect();
    spectrumSmallChart?.dispose();
    spectrumBigChart?.dispose();
    window.removeEventListener('keydown', onKeydown);
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['header-left']} */ ;
/** @type {__VLS_StyleScopedClasses['badge']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-time']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-val']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-row']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['blue']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-row']} */ ;
/** @type {__VLS_StyleScopedClasses['compact']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['mpanel']} */ ;
/** @type {__VLS_StyleScopedClasses['cvs-box']} */ ;
/** @type {__VLS_StyleScopedClasses['big-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['chart-box']} */ ;
/** @type {__VLS_StyleScopedClasses['cvs-box']} */ ;
/** @type {__VLS_StyleScopedClasses['big']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['dot-index']} */ ;
// CSS variable injection 
// CSS variable injection end 
const __VLS_0 = {}.Teleport;
/** @type {[typeof __VLS_components.Teleport, typeof __VLS_components.Teleport, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    to: "body",
}));
const __VLS_2 = __VLS_1({
    to: "body",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
if (__VLS_ctx.store.monitorOpen) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "monitor-root" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
        ...{ class: "monitor-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "header-left" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "badge readonly" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "badge" },
        ...{ class: (__VLS_ctx.statusClass) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
        ...{ class: "status-dot" },
    });
    (__VLS_ctx.statusText);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-time" },
    });
    (__VLS_ctx.clock);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "header-readings" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mini-reading" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-val blue" },
    });
    (__VLS_ctx.typeText);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mini-reading" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-val" },
    });
    (__VLS_ctx.confidenceText);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mini-reading" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-val" },
    });
    (__VLS_ctx.symbolRateText);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mini-reading" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-label" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "mini-val" },
    });
    (__VLS_ctx.freqOffsetText);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "header-actions" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "meta-time small" },
    });
    (__VLS_ctx.store.monitorLastChecked || '—');
    const __VLS_4 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
        ...{ 'onClick': {} },
        size: "small",
        loading: (__VLS_ctx.store.monitorFetching),
    }));
    const __VLS_6 = __VLS_5({
        ...{ 'onClick': {} },
        size: "small",
        loading: (__VLS_ctx.store.monitorFetching),
    }, ...__VLS_functionalComponentArgsRest(__VLS_5));
    let __VLS_8;
    let __VLS_9;
    let __VLS_10;
    const __VLS_11 = {
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.store.monitorOpen))
                return;
            __VLS_ctx.store.refreshMonitor();
        }
    };
    __VLS_7.slots.default;
    var __VLS_7;
    const __VLS_12 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
        ...{ 'onClick': {} },
        size: "small",
        type: (__VLS_ctx.autoplay ? 'primary' : 'default'),
    }));
    const __VLS_14 = __VLS_13({
        ...{ 'onClick': {} },
        size: "small",
        type: (__VLS_ctx.autoplay ? 'primary' : 'default'),
    }, ...__VLS_functionalComponentArgsRest(__VLS_13));
    let __VLS_16;
    let __VLS_17;
    let __VLS_18;
    const __VLS_19 = {
        onClick: (__VLS_ctx.toggleAutoplay)
    };
    __VLS_15.slots.default;
    (__VLS_ctx.autoplay ? '⏸ 暂停轮播' : '▶ 自动轮播');
    var __VLS_15;
    const __VLS_20 = {}.ElButton;
    /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
    // @ts-ignore
    const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
        ...{ 'onClick': {} },
        size: "small",
        type: "danger",
        plain: true,
    }));
    const __VLS_22 = __VLS_21({
        ...{ 'onClick': {} },
        size: "small",
        type: "danger",
        plain: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_21));
    let __VLS_24;
    let __VLS_25;
    let __VLS_26;
    const __VLS_27 = {
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.store.monitorOpen))
                return;
            __VLS_ctx.store.closeMonitor();
        }
    };
    __VLS_23.slots.default;
    var __VLS_23;
    if (!__VLS_ctx.store.monitorSnapshot) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "monitor-empty" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-icon" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-title" },
        });
        (__VLS_ctx.emptyTitle);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-desc" },
        });
        (__VLS_ctx.emptyDesc);
        const __VLS_28 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
            ...{ 'onClick': {} },
            type: "primary",
            loading: (__VLS_ctx.store.monitorFetching),
        }));
        const __VLS_30 = __VLS_29({
            ...{ 'onClick': {} },
            type: "primary",
            loading: (__VLS_ctx.store.monitorFetching),
        }, ...__VLS_functionalComponentArgsRest(__VLS_29));
        let __VLS_32;
        let __VLS_33;
        let __VLS_34;
        const __VLS_35 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.store.monitorOpen))
                    return;
                if (!(!__VLS_ctx.store.monitorSnapshot))
                    return;
                __VLS_ctx.store.refreshMonitor();
            }
        };
        __VLS_31.slots.default;
        var __VLS_31;
    }
    else {
        if (__VLS_ctx.store.monitorStatus === 'stale') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "stale-banner" },
            });
            (__VLS_ctx.store.monitorError ? `（${__VLS_ctx.store.monitorError}）` : '');
            (__VLS_ctx.dataTime);
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
            ...{ onMouseenter: (...[$event]) => {
                    if (!(__VLS_ctx.store.monitorOpen))
                        return;
                    if (!!(!__VLS_ctx.store.monitorSnapshot))
                        return;
                    __VLS_ctx.hovering = true;
                } },
            ...{ onMouseleave: (...[$event]) => {
                    if (!(__VLS_ctx.store.monitorOpen))
                        return;
                    if (!!(!__VLS_ctx.store.monitorSnapshot))
                        return;
                    __VLS_ctx.hovering = false;
                } },
            ...{ class: "monitor-body" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "slide slide-overview" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.store.monitorSlide === 0) }, null, null);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-row" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-value blue" },
        });
        (__VLS_ctx.typeText);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-value" },
        });
        (__VLS_ctx.confidenceText);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-value" },
        });
        (__VLS_ctx.symbolRateText);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-value" },
        });
        (__VLS_ctx.freqOffsetText);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "overview-mosaic" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "mpanel mp-spectrum" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ref: "spectrumSmallEl",
            ...{ class: "chart-box" },
        });
        /** @type {typeof __VLS_ctx.spectrumSmallEl} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "mpanel mp-constellation" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.canvas, __VLS_intrinsicElements.canvas)({
            ref: "constSmallCvs",
            ...{ class: "cvs-box" },
        });
        /** @type {typeof __VLS_ctx.constSmallCvs} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "mpanel mp-waterfall" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.canvas, __VLS_intrinsicElements.canvas)({
            ref: "waterSmallCvs",
            ...{ class: "cvs-box" },
        });
        /** @type {typeof __VLS_ctx.waterSmallCvs} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "mpanel mp-candidates" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "candidate-list" },
        });
        for (const [c] of __VLS_getVForSourceType((__VLS_ctx.candidates))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (c.type),
                ...{ class: "candidate-row-lg" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "c-type-lg" },
            });
            (c.type);
            const __VLS_36 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({
                percentage: (Math.round(c.score * 100)),
                strokeWidth: (12),
                color: (__VLS_ctx.progressColor(c.score)),
            }));
            const __VLS_38 = __VLS_37({
                percentage: (Math.round(c.score * 100)),
                strokeWidth: (12),
                color: (__VLS_ctx.progressColor(c.score)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_37));
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "slide slide-dual" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.store.monitorSlide === 1) }, null, null);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "big-panel" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ref: "spectrumBigEl",
            ...{ class: "chart-box big" },
        });
        /** @type {typeof __VLS_ctx.spectrumBigEl} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "big-panel" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.canvas, __VLS_intrinsicElements.canvas)({
            ref: "waterBigCvs",
            ...{ class: "cvs-box big" },
        });
        /** @type {typeof __VLS_ctx.waterBigCvs} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "slide slide-dual" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.store.monitorSlide === 2) }, null, null);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "big-panel" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.canvas, __VLS_intrinsicElements.canvas)({
            ref: "constBigCvs",
            ...{ class: "cvs-box big" },
        });
        /** @type {typeof __VLS_ctx.constBigCvs} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "big-panel modulation-panel" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-row compact" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-value blue" },
        });
        (__VLS_ctx.typeText);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-value" },
        });
        (__VLS_ctx.confidenceText);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-card" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-label" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "kpi-value" },
        });
        (__VLS_ctx.symbolRateText);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "candidate-list big-list" },
        });
        for (const [c] of __VLS_getVForSourceType((__VLS_ctx.candidates))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (c.type),
                ...{ class: "candidate-row-lg" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "c-type-lg" },
            });
            (c.type);
            const __VLS_40 = {}.ElProgress;
            /** @type {[typeof __VLS_components.ElProgress, typeof __VLS_components.elProgress, ]} */ ;
            // @ts-ignore
            const __VLS_41 = __VLS_asFunctionalComponent(__VLS_40, new __VLS_40({
                percentage: (Math.round(c.score * 100)),
                strokeWidth: (16),
                color: (__VLS_ctx.progressColor(c.score)),
            }));
            const __VLS_42 = __VLS_41({
                percentage: (Math.round(c.score * 100)),
                strokeWidth: (16),
                color: (__VLS_ctx.progressColor(c.score)),
            }, ...__VLS_functionalComponentArgsRest(__VLS_41));
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.prevSlide) },
            ...{ class: "nav-arrow left" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.nextSlide) },
            ...{ class: "nav-arrow right" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "dots" },
        });
        for (const [t, i] of __VLS_getVForSourceType((__VLS_ctx.slideTitles))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.store.monitorOpen))
                            return;
                        if (!!(!__VLS_ctx.store.monitorSnapshot))
                            return;
                        __VLS_ctx.goSlide(i);
                    } },
                key: (t),
                ...{ class: "dot" },
                ...{ class: ({ active: __VLS_ctx.store.monitorSlide === i }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "dot-index" },
            });
            (i + 1);
            (t);
        }
    }
}
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['monitor-root']} */ ;
/** @type {__VLS_StyleScopedClasses['monitor-header']} */ ;
/** @type {__VLS_StyleScopedClasses['header-left']} */ ;
/** @type {__VLS_StyleScopedClasses['badge']} */ ;
/** @type {__VLS_StyleScopedClasses['readonly']} */ ;
/** @type {__VLS_StyleScopedClasses['badge']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-time']} */ ;
/** @type {__VLS_StyleScopedClasses['header-readings']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-reading']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-label']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-val']} */ ;
/** @type {__VLS_StyleScopedClasses['blue']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-reading']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-label']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-val']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-reading']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-label']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-val']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-reading']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-label']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-val']} */ ;
/** @type {__VLS_StyleScopedClasses['header-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['meta-time']} */ ;
/** @type {__VLS_StyleScopedClasses['small']} */ ;
/** @type {__VLS_StyleScopedClasses['monitor-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-title']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-desc']} */ ;
/** @type {__VLS_StyleScopedClasses['stale-banner']} */ ;
/** @type {__VLS_StyleScopedClasses['monitor-body']} */ ;
/** @type {__VLS_StyleScopedClasses['slide']} */ ;
/** @type {__VLS_StyleScopedClasses['slide-overview']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-row']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-card']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-label']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['blue']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-card']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-label']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-card']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-label']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-card']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-label']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['overview-mosaic']} */ ;
/** @type {__VLS_StyleScopedClasses['mpanel']} */ ;
/** @type {__VLS_StyleScopedClasses['mp-spectrum']} */ ;
/** @type {__VLS_StyleScopedClasses['chart-box']} */ ;
/** @type {__VLS_StyleScopedClasses['mpanel']} */ ;
/** @type {__VLS_StyleScopedClasses['mp-constellation']} */ ;
/** @type {__VLS_StyleScopedClasses['cvs-box']} */ ;
/** @type {__VLS_StyleScopedClasses['mpanel']} */ ;
/** @type {__VLS_StyleScopedClasses['mp-waterfall']} */ ;
/** @type {__VLS_StyleScopedClasses['cvs-box']} */ ;
/** @type {__VLS_StyleScopedClasses['mpanel']} */ ;
/** @type {__VLS_StyleScopedClasses['mp-candidates']} */ ;
/** @type {__VLS_StyleScopedClasses['candidate-list']} */ ;
/** @type {__VLS_StyleScopedClasses['candidate-row-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['c-type-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['slide']} */ ;
/** @type {__VLS_StyleScopedClasses['slide-dual']} */ ;
/** @type {__VLS_StyleScopedClasses['big-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['chart-box']} */ ;
/** @type {__VLS_StyleScopedClasses['big']} */ ;
/** @type {__VLS_StyleScopedClasses['big-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['cvs-box']} */ ;
/** @type {__VLS_StyleScopedClasses['big']} */ ;
/** @type {__VLS_StyleScopedClasses['slide']} */ ;
/** @type {__VLS_StyleScopedClasses['slide-dual']} */ ;
/** @type {__VLS_StyleScopedClasses['big-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['cvs-box']} */ ;
/** @type {__VLS_StyleScopedClasses['big']} */ ;
/** @type {__VLS_StyleScopedClasses['big-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['modulation-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-row']} */ ;
/** @type {__VLS_StyleScopedClasses['compact']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-card']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-label']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['blue']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-card']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-label']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-card']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-label']} */ ;
/** @type {__VLS_StyleScopedClasses['kpi-value']} */ ;
/** @type {__VLS_StyleScopedClasses['candidate-list']} */ ;
/** @type {__VLS_StyleScopedClasses['big-list']} */ ;
/** @type {__VLS_StyleScopedClasses['candidate-row-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['c-type-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['left']} */ ;
/** @type {__VLS_StyleScopedClasses['nav-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['right']} */ ;
/** @type {__VLS_StyleScopedClasses['dots']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['dot-index']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            store: store,
            slideTitles: slideTitles,
            autoplay: autoplay,
            hovering: hovering,
            clock: clock,
            spectrumSmallEl: spectrumSmallEl,
            spectrumBigEl: spectrumBigEl,
            constSmallCvs: constSmallCvs,
            constBigCvs: constBigCvs,
            waterSmallCvs: waterSmallCvs,
            waterBigCvs: waterBigCvs,
            typeText: typeText,
            confidenceText: confidenceText,
            symbolRateText: symbolRateText,
            freqOffsetText: freqOffsetText,
            candidates: candidates,
            dataTime: dataTime,
            statusClass: statusClass,
            statusText: statusText,
            emptyTitle: emptyTitle,
            emptyDesc: emptyDesc,
            progressColor: progressColor,
            goSlide: goSlide,
            nextSlide: nextSlide,
            prevSlide: prevSlide,
            toggleAutoplay: toggleAutoplay,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */

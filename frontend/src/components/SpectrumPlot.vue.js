/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { ref, watch, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts';
import { useSignalStore } from '../store/signal';
const store = useSignalStore();
const chart = ref();
let instance = null;
function update() {
    if (!instance || !store.result)
        return;
    const { frequencies, magnitudes } = store.result.spectrum;
    const n = frequencies.length;
    const halfN = Math.floor(n / 2);
    const data = [];
    for (let i = 0; i < halfN; i++) {
        data.push([frequencies[i], magnitudes[i]]);
    }
    instance.setOption({
        backgroundColor: 'transparent',
        grid: { left: 50, right: 15, top: 15, bottom: 35 },
        xAxis: { type: 'value', name: '频率 (Hz)', nameLocation: 'middle', nameGap: 25, axisLabel: { color: '#8899aa' } },
        yAxis: { type: 'value', name: '幅度 (dB)', nameLocation: 'middle', nameGap: 40, axisLabel: { color: '#8899aa' } },
        series: [{
                type: 'line', data, symbol: 'none', lineStyle: { color: '#42a5f5', width: 1.5 },
                areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(66,165,245,0.4)' }, { offset: 1, color: 'rgba(66,165,245,0.02)' }]) }
            }],
        animation: false
    });
}
onMounted(() => {
    if (chart.value) {
        instance = echarts.init(chart.value);
        update();
    }
});
watch(() => store.result, update);
onUnmounted(() => { instance?.dispose(); });
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ref: "chart",
    ...{ class: "chart" },
});
/** @type {typeof __VLS_ctx.chart} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['chart']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            chart: chart,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */

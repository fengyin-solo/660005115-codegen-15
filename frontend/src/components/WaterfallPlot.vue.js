/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { ref, watch, onMounted } from 'vue';
import { useSignalStore } from '../store/signal';
const store = useSignalStore();
const cvs = ref();
function draw() {
    const c = cvs.value;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const rows = store.result?.waterfall || [];
    if (!rows.length)
        return;
    ctx.fillStyle = '#0d1520';
    ctx.fillRect(0, 0, W, H);
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
onMounted(draw);
watch(() => store.result, draw);
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "panel" },
    ...{ style: {} },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.canvas, __VLS_intrinsicElements.canvas)({
    ref: "cvs",
    width: "800",
    height: "200",
    ...{ class: "waterfall-canvas" },
});
/** @type {typeof __VLS_ctx.cvs} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['waterfall-canvas']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            cvs: cvs,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */

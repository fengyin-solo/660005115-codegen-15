# 射频信号频谱分析与调制识别仪

基于Vue 3 + FastAPI的射频信号分析工具，支持IQ数据导入、FFT频谱/瀑布图/星座图三面板可视化、自动调制分类识别。

## 目标用户
业余无线电爱好者、信号工程师、通信专业学生

## 技术栈
- 前端: Vue 3 + TypeScript + Vite + Pinia + Element Plus + ECharts
- 后端: Python FastAPI + NumPy + SciPy

## 核心功能
1. IQ基带数据CSV文件导入，支持采样率/中心频率参数配置
2. FFT频谱图(ECharts)、瀑布图(Canvas)与星座图(Canvas)三面板同步
3. AM/FM/BPSK/QPSK/16QAM五种调制模式自动识别分类
4. 信号参数估算(符号速率、载波频率偏移)
5. 频谱分析结果JSON/PNG导出
6. 只读监控大屏：关键读数与图表同屏概览，自动轮播/手动切换，空态与读取失败提示
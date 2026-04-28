<template>
  <main class="page-shell rules-page-shell">
    <section class="page-container rules-page-container">
      <el-card shadow="hover" class="rules-card">
        <template #header>
          <div class="rules-header">
            <el-button link type="primary" @click="$emit('back')">返回查询</el-button>
            <h1>规则说明</h1>
            <span class="rules-header-spacer" />
          </div>
        </template>

        <div class="rules-section">
          <h2>推荐目标</h2>
          <p>当前查询页会基于 12306 可售数据，综合直达、买长坐短、席别类型、时长和价格，给出一个最优推荐方案。</p>
        </div>

        <div class="rules-section">
          <h2>候选如何产生</h2>
          <ol>
            <li>先筛出真实乘坐区间能覆盖出发城市到到达城市的车次。</li>
            <li>围绕真实乘坐区间，枚举可购票区间，生成直达和买长坐短两类候选。</li>
            <li>坐席和卧铺分开建候选，每个购票区间只保留该类别里价格最低的可行方案。</li>
          </ol>
        </div>

        <div class="rules-section">
          <h2>候选如何归并</h2>
          <p>对于同一车次、同一实际乘坐区间、同一席别类别的方案，只保留优先级更高的一条：</p>
          <ul>
            <li>先比价格，便宜优先。</li>
            <li>若价格相同，直达优先于买长坐短。</li>
            <li>若仍相同，购票跨越站数更少的优先。</li>
            <li>最后再比较出发时间。</li>
          </ul>
        </div>

        <div class="rules-section">
          <h2>最优排序规则</h2>
          <ul>
            <li>短途与长途以 5.5 小时为分界。</li>
            <li>短途优先看价格，再看是否直达，再看实际耗时。</li>
            <li>长途优先卧铺，再看耗时，再看是否直达，最后才看价格。</li>
          </ul>
        </div>

        <div class="rules-section">
          <h2>推荐理由文案</h2>
          <p>页面里的“推荐理由”会根据短途 / 长途、直达 / 买长坐短、坐席 / 卧铺的组合自动生成，用来解释为什么该方案被排在第一位。</p>
        </div>
      </el-card>
    </section>
  </main>
</template>

<script setup lang="ts">
defineEmits<{
  back: [];
}>();
</script>

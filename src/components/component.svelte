<script lang="ts">
  export let variable: number;
</script>

<div class="memolist-wrapper">
  <div class="memo-wrapper">
    <span>My number is {variable}!</span>
  </div>
  <div class="memo-wrapper">
    <span>My number is {variable}!</span>
  </div>
</div>

<style>
  .memolist-wrapper {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    flex-grow: 1;
    width: 100%;
    overflow-y: scroll;
    gap: 8px;
    scrollbar-width: none;
  }
  .memo-wrapper {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    width: 100%;
    padding: 12px 18px;
    background-color: #ffffff;
    border-radius: 8px;
    border: 1px solid #f1f1f1;
  }
</style>
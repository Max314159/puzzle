/**
 * 拼图游戏配置
 * - levels[].imageSrc: 这一关的原图（每关可不同）
 * - levels[].title: 关卡名称，显示在界面上
 * - levels[].cols / rows: 横向、纵向切分数量
 * - levels[].timeLimitMs: 这一关的限时（毫秒）；不写则用顶层 timeLimitMs
 * - timeLimitMs: 未单独配置关卡限时时的默认值（默认 5 分钟）
 * - previewHint: 倒计时画面上的提示文字，置空则不显示
 */
window.PUZZLE_CONFIG = {
  timeLimitMs: 5 * 60 * 1000,
  previewMs: 2000,
  countdownFrom: 3,
  previewHint: "开始游戏前请记住图片的样子",
  nextLevelDelayMs: 3000,
  fallbackImageSrc: "./assets/puzzle.svg",
  levels: [
    {
      title: "",
      cols: 2,
      rows: 2,
      timeLimitMs: 3 * 60 * 1000,
      imageSrc: "./assets/1.png",
    },
    {
      title: "",
      cols: 3,
      rows: 3,
      timeLimitMs: 5 * 60 * 1000,
      imageSrc: "./assets/2.png",
    },
  ],
};
import { useState } from 'react';

/**
 * 内嵌影片（YouTube/Vimeo/Google Drive）+ 浮水印的包装元件。
 *
 * 全萤幕这里改用「假全萤幕」（纯 CSS position:fixed 撑满整个画面），不呼叫浏览器原生的
 * Fullscreen API。原因：iOS Safari 完全不支援对一般 <div> 呼叫 requestFullscreen()，
 * 只有 <video> 标签本身才支援（这是苹果的平台限制，不是我们能绕过的），如果用原生 API，
 * 在 iPhone 上按钮会完全没反应。改成自己用 CSS 控制「占满画面」的视觉效果，
 * 所有装置都能用，浮水印当然也会一起被盖满画面显示（因为浮水印本来就是这个容器的子元素）。
 *
 * Google Drive 的内嵌预览播放器右上角有自己的「在新分页开启」跳出按钮，我们没办法从外部
 * 直接移除跨网域 iframe 里面的元素，改用跟 PDF 那里一样的做法——疊一层透明的遮挡层，
 * 盖住那个按钮的位置，点了没有反应，但畫面上還是看得到（只是点不到）。
 */
export default function WatermarkedVideo({ embedUrl, watermarkText, index }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isDrive = embedUrl.includes('drive.google.com');

  return (
    <div className={`inline-video-wrap ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <iframe
        className="inline-video"
        src={embedUrl}
        title={`video-${index}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      />
      {isDrive && <div className="inline-video-block-corner" title="" />}
      <div className="inline-video-watermark" aria-hidden="true">{watermarkText}</div>
      <button type="button" className="inline-video-fs-btn" onClick={() => setIsFullscreen((v) => !v)} title="全萤幕">
        {isFullscreen ? '⤡' : '⤢'}
      </button>
    </div>
  );
}

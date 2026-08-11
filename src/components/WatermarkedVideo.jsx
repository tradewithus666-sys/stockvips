import { useRef, useState } from 'react';

/**
 * 内嵌影片（YouTube/Vimeo/Google Drive）+ 浮水印的包装元件。
 *
 * 关键问题：第三方播放器（YouTube 等）自带的全萤幕按钮，只会把「它自己那个 iframe」拉去全萤幕，
 * 我们叠在上面的浮水印是页面上的另一个独立元素，不会被一起带进去——这是浏览器 Fullscreen API
 * 的标准行为（全萤幕的对象是你实际呼叫 requestFullscreen() 的那个元素本身，包含它的子元素，
 * 不包含页面上其他独立的兄弟元素），加上 YouTube 是别人网站的跨网域内容，我们也没办法把
 * 自己的东西塞进它内部的全萤幕画面。
 *
 * 解法：拿掉 iframe 的 allowFullScreen（大部分播放器没有这个权限时，自己内建的全萤幕按钮会失效／隐藏），
 * 改成我们自己包一个外层 wrapper（里面同时放 iframe + 浮水印文字），
 * 用自己的按钮呼叫 wrapper.requestFullscreen()——这样浏览器全萤幕的对象是整个 wrapper，
 * 浮水印会跟着一起被带进全萤幕画面。
 */
export default function WatermarkedVideo({ embedUrl, watermarkText, index }) {
  const wrapRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  function toggleFullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    const isCurrentlyFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (isCurrentlyFullscreen) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      setIsFullscreen(false);
    } else {
      const request = el.requestFullscreen || el.webkitRequestFullscreen;
      request?.call(el);
      setIsFullscreen(true);
    }
  }

  return (
    <div className="inline-video-wrap" ref={wrapRef}>
      {/* 故意不给 allowFullScreen，逼使用者用我们自己的全萤幕按钮，浮水印才能一起进全萤幕 */}
      <iframe
        className="inline-video"
        src={embedUrl}
        title={`video-${index}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      />
      <div className="inline-video-watermark" aria-hidden="true">{watermarkText}</div>
      <button type="button" className="inline-video-fs-btn" onClick={toggleFullscreen} title="全萤幕">
        {isFullscreen ? '⤡' : '⤢'}
      </button>
    </div>
  );
}

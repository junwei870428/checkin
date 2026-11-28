// 掃描頁開著時不讓螢幕休眠，相機才不會在報到空檔中斷。
// 切到其他 App 或鎖定螢幕時瀏覽器會自動放開，回到頁面再重新取得。
// 不支援（iOS 16.3 以前、非 https）或被拒絕時不影響報到，只是螢幕會照系統設定休眠。
import { useEffect } from 'react';

export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (active) lock = l;
        else void l.release();
      } catch {
        // 省電模式或瀏覽器拒絕時不處理
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, []);
}

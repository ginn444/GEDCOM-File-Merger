/// <reference lib="webworker" />
import { runMerge } from './worker';

self.onmessage = (e: MessageEvent) => {
  const { fileTexts, fileNames } = e.data;
  try {
    const result = runMerge(fileTexts, fileNames);
    (self as unknown as Worker).postMessage({ success: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

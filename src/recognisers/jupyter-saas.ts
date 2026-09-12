import type { DelegatedExecutionPlatform } from "../core/types.js";

const KERNEL_CHANNELS_PATH_RE = /\/api\/kernels\/[^/]+\/channels/i;

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const isHostOrSubdomain = (host: string | undefined, expected: string): boolean =>
  host === expected || host?.endsWith(`.${expected}`) === true;

export const isJupyterKernelChannelsUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ["ws:", "wss:"].includes(parsed.protocol) && KERNEL_CHANNELS_PATH_RE.test(parsed.pathname);
  } catch {
    return false;
  }
};

export const identifyJupyterSaasPlatform = (
  _pageUrl: string,
  socketUrl: string
): DelegatedExecutionPlatform => {
  const socketHost = hostOf(socketUrl);

  if (socketHost?.endsWith(".prod.colab.dev") === true) {
    return "google-colab";
  }

  const kaggleSocket =
    isHostOrSubdomain(socketHost, "kaggle.com") ||
    isHostOrSubdomain(socketHost, "kaggleusercontent.com");
  if (isJupyterKernelChannelsUrl(socketUrl) && kaggleSocket) {
    return "kaggle-notebooks";
  }

  return "unknown";
};

export const jupyterPlatformLabel = (platform: DelegatedExecutionPlatform): string => {
  if (platform === "google-colab") return "Google Colab";
  if (platform === "kaggle-notebooks") return "Kaggle Notebooks";
  return "Unknown Jupyter platform";
};

export const jupyterRecogniserId = (platform: DelegatedExecutionPlatform): string => {
  if (platform === "google-colab") return "colab";
  if (platform === "kaggle-notebooks") return "kaggle-notebooks";
  return "jupyter-unknown";
};

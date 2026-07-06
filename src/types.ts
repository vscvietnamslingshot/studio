export interface StreamSettings {
  roomId: string;
  layout: "grid" | "split" | "pip-host" | "pip-athlete" | "side-by-side" | "single" | "custom";
  logoUrl: string;
  logoPosition: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  logoSize: number; // percentage width (e.g., 8 for 8%)
  bannerText: string;
  bannerBgColor: string;
  bannerTextColor: string;
  tickerText: string;
  tickerSpeed: number; // seconds for marquee loop or relative speed
  showTicker: boolean;
  showBanner: boolean;
  backgroundStyle: "transparent" | "dark-slate" | "neon-cyber" | "soft-gradient";
  highlightedClientId: string; // The peer ID currently highlighted (for single/pip views)
  
  // Scoreboard / Contest System
  showScoreboard: boolean;
  showIndividualScores?: boolean;
  scoreboardTitle: string;
  scoreboardEventName: string;
  scores: Record<string, number>; // key: clientId/athleteId, value: score
  scoreNames: Record<string, string>; // key: clientId/athleteId, value: custom name for scoreboard
  
  // Lower thirds / Participant Info Bar
  showLowerThirds: boolean;
  lowerThirdText: string;
  
  // Aspect Ratio Settings
  aspectRatio?: "16:9" | "9:16";
  
  // Individual participant camera transform/orientation settings
  cameraRotations?: Record<string, number>; // key: peerId, value: degrees (0, 90, 180, 270)
  cameraAspects?: Record<string, "16:9" | "9:16">; // key: peerId, value: aspect ratio (normal 16:9 or vertical 9:16)
  cameraFits?: Record<string, "cover" | "contain">; // key: peerId, value: "cover" or "contain"
  
  // Custom graphics overlay, positions, cropping, layering, and hidden states
  hiddenPeers?: Record<string, boolean>; // key: peerId, value: hidden state
  peerOrder?: string[]; // array of peerIds determining overlay stack order (first is back, last is front)
  peerPositions?: Record<string, { x: number; y: number; w: number; h: number }>; // key: peerId, values in percent (0-100)
  peerCrops?: Record<string, { top: number; bottom: number; left: number; right: number }>; // key: peerId, values in percent (0-100)
  
  // Scoreboard Position, Crop & Size
  scoreboardPosition?: { x: number; y: number; w: number; h: number }; // in percent (0-100)
  scoreboardCrop?: { top: number; bottom: number; left: number; right: number }; // in percent (0-100)
  scoreboardBgOpacity?: number; // 0 to 100
  scoreboardBgBlur?: number; // backdrop blur in px (0 to 24)

  // Logo Brand position, crop
  logoPositionCustom?: { x: number; y: number; w: number; h: number };
  logoCrop?: { top: number; bottom: number; left: number; right: number };

  // Banner Tiêu đề đỉnh (Top Banner) position, crop, opacity
  bannerPosition?: { x: number; y: number; w: number; h: number };
  bannerCrop?: { top: number; bottom: number; left: number; right: number };
  bannerBgOpacity?: number; // 0 to 100

  // Chữ chạy chân trang (Ticker) position, crop, opacity
  tickerPosition?: { x: number; y: number; w: number; h: number };
  tickerCrop?: { top: number; bottom: number; left: number; right: number };
  tickerBgColor?: string;
  tickerBgOpacity?: number; // 0 to 100

  // Khung chữ hiển thị trái (Lower Third) position, crop, opacity
  lowerThirdPosition?: { x: number; y: number; w: number; h: number };
  lowerThirdCrop?: { top: number; bottom: number; left: number; right: number };
  lowerThirdBgColor?: string;
  lowerThirdBgOpacity?: number; // 0 to 100

  // Individual athlete score/name badge overlays (position and opacity)
  scoreBadgePositions?: Record<string, { x: number; y: number }>; // key: peerId, value: {x, y} in %
  scoreBadgeBgOpacity?: number; // 0 to 100 (default 90)
  scoreBadgeScales?: Record<string, number>; // key: peerId, value: scale multiplier (0.5 to 2.5)

  // Toggle PIP (circular shape) mode for each participant
  pipPeers?: Record<string, boolean>; // key: peerId, value: boolean
  pipLayoutPosition?: { x: number; y: number }; // Percentage position of floating round PIP (for layout pip-host/pip-athlete)

  // 4G mode toggle (Force TURN)
  use4GMode?: boolean;

  // Pre-configured athlete invites and visible slots count (synchronized to OBS)
  athleteInvites?: { id: string; name: string }[];
  visibleSlotsCount?: number;

  // Bandwidth allocation priority: "vsc-overlay" (Default), "solo-link", or "none" (turn off both)
  bandwidthPriority?: "vsc-overlay" | "solo-link" | "none";
}

export interface PeerState {
  id: string;
  role: "host" | "athlete" | "obs";
  name: string;
  audioActive: boolean;
  videoActive: boolean;
}

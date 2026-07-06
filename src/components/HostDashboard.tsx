import React, { useState, useEffect, useRef } from "react";
import { 
  Tv, Users, Video, VideoOff, Mic, MicOff, Settings, Sparkles, Trophy, 
  Layers, Volume2, Share2, Copy, Check, Radio, CheckCircle, Flame, Plus, Minus, RefreshCw, LogOut,
  Trash2, Link, Eye, EyeOff
} from "lucide-react";
import { StreamSettings } from "../types";
import { ObsRenderer } from "./ObsRenderer";
const defaultLogo = "https://lh3.googleusercontent.com/d/1CAz9xUSO8XIvtEy9TYqil228Cz-jYcIM";

let cachedEcdsaCertificate: RTCCertificate | null = null;
if (typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && RTCPeerConnection.generateCertificate) {
  RTCPeerConnection.generateCertificate({
    name: "ECDSA",
    namedCurve: "P-256"
  } as any).then(cert => {
    cachedEcdsaCertificate = cert;
    console.log("[WebRTC Host] ECDSA certificate generated successfully for 4G cellular compatibility.");
  }).catch(err => {
    console.warn("[WebRTC Host] Failed to pre-generate ECDSA certificate, falling back to default RSA:", err);
  });
}

const getWebRtcConfig = (forceTurn: boolean): RTCConfiguration => {
  // A highly optimized, clean list of TURN URLs to prevent socket flooding and firewall blocks on 4G.
  // We use standard port 3478 and secure port 443 (which looks like HTTPS, bypassing cellular firewalls perfectly).
  const turnServers = [
    {
      urls: [
        "turn:openrelay.metered.ca:3478?transport=udp",
        "turn:openrelay.metered.ca:3478?transport=tcp",
        "turn:openrelay.metered.ca:443?transport=udp",
        "turns:openrelay.metered.ca:443?transport=tcp"
      ],
      username: "openrelay",
      credential: "openrelay"
    }
  ];

  // Highly reliable Google STUN servers + Mozilla STUN server.
  // Google's STUN servers are dual-stack (IPv4 and IPv6) and globally optimized.
  const stunServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ];

  const iceServers = forceTurn
    ? turnServers // For 4G Mode / Force TURN, only allow TURN relay servers
    : [...stunServers, ...turnServers]; // Otherwise, use both STUN and TURN for maximum fallback reliability

  const config: RTCConfiguration = {
    iceServers,
    bundlePolicy: "max-bundle" as RTCBundlePolicy,
    rtcpMuxPolicy: "require" as RTCRtcpMuxPolicy,
    // CRITICAL iOS Safari & Mobile Chrome Bugfix: 
    // Setting iceCandidatePoolSize > 0 can cause ICE gathering state to get stuck/frozen on mobile browsers, 
    // leading to permanent 'checking' or 'failed' connection states. Force 0 for maximum stability.
    iceCandidatePoolSize: 0,
    // Use strictly "relay" for 4G Mode to force TURN connection and avoid frozen states or un-routable direct paths.
    iceTransportPolicy: forceTurn ? "relay" : "all"
  };

  if (cachedEcdsaCertificate) {
    config.certificates = [cachedEcdsaCertificate];
  }

  return config;
};

const preferH264 = (sdp: string): string => {
  if (!sdp) return sdp;
  const lines = sdp.split("\r\n");
  if (lines.length <= 1) {
    const lfLines = sdp.split("\n");
    const mLineIndex = lfLines.findIndex(line => line.startsWith("m=video"));
    if (mLineIndex === -1) return sdp;
    const h264Payloads: string[] = [];
    lfLines.forEach(line => {
      if (line.startsWith("a=rtpmap:") && line.toLowerCase().includes("h264/90000")) {
        const matches = line.match(/a=rtpmap:(\d+)\s+H264\/90000/i);
        if (matches) h264Payloads.push(matches[1]);
      }
    });
    if (h264Payloads.length > 0) {
      const parts = lfLines[mLineIndex].split(" ");
      const header = parts.slice(0, 3);
      const payloads = parts.slice(3);
      const otherPayloads = payloads.filter(pt => !h264Payloads.includes(pt));
      lfLines[mLineIndex] = [...header, ...h264Payloads, ...otherPayloads].join(" ");
    }
    return lfLines.join("\n");
  }

  const mLineIndex = lines.findIndex(line => line.startsWith("m=video"));
  if (mLineIndex === -1) return sdp;
  const h264Payloads: string[] = [];
  lines.forEach(line => {
    if (line.startsWith("a=rtpmap:") && line.toLowerCase().includes("h264/90000")) {
      const matches = line.match(/a=rtpmap:(\d+)\s+H264\/90000/i);
      if (matches) h264Payloads.push(matches[1]);
    }
  });
  if (h264Payloads.length > 0) {
    const parts = lines[mLineIndex].split(" ");
    const header = parts.slice(0, 3);
    const payloads = parts.slice(3);
    const otherPayloads = payloads.filter(pt => !h264Payloads.includes(pt));
    lines[mLineIndex] = [...header, ...h264Payloads, ...otherPayloads].join(" ");
  }
  return lines.join("\r\n");
};

interface HostDashboardProps {
  roomId: string;
  initialMcName: string;
  onLeave: () => void;
}

interface ConnectedPeer {
  id: string;
  name: string;
  role: "athlete" | "obs";
  stream?: MediaStream;
  isMirrored?: boolean;
}

export function HostDashboard({ roomId, initialMcName, onLeave }: HostDashboardProps) {
  const [mcName, setMcName] = useState(initialMcName || "MC Ban Tổ Chức");
  const [layoutsGrouped, setLayoutsGrouped] = useState(false);
  const [scoreboardSettingsCollapsed, setScoreboardSettingsCollapsed] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(true);
  const [micActive, setMicActive] = useState(true);
  
  // MC camera quality configurations
  const [hostResolution, setHostResolution] = useState<"1080p" | "720p" | "480p" | "360p">("720p");
  const [mcCustomSettingsApplied, setMcCustomSettingsApplied] = useState<boolean>(false);
  const [hostSelectedVideo, setHostSelectedVideo] = useState<string>("auto");
  const [hostZoom, setHostZoom] = useState<number>(1.0);
  const [hostDevices, setHostDevices] = useState<MediaDeviceInfo[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [copiedObsLink, setCopiedObsLink] = useState(false);
  const [copiedSoloObsId, setCopiedSoloObsId] = useState<string | null>(null);
  const [showGraphicsSettings, setShowGraphicsSettings] = useState(true);

  // Active production config (synced dynamically with OBS)
  const [settings, setSettings] = useState<StreamSettings>(() => {
    const defaultInvites = [
      { id: "inv_1", name: "Nguyễn Văn A" },
      { id: "inv_2", name: "Trần Thị B" },
      { id: "inv_3", name: "Lê Văn C" },
      { id: "inv_4", name: "Phạm Thị D" }
    ];
    let savedInvites = defaultInvites;
    try {
      const saved = localStorage.getItem(`athlete_invites_${roomId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const merged = [...parsed];
          for (let i = merged.length; i < 4; i++) {
            merged.push(defaultInvites[i]);
          }
          savedInvites = merged.slice(0, 4);
        }
      }
    } catch (e) {}

    let savedVisibleSlots = 1;
    try {
      const saved = localStorage.getItem(`visible_slots_${roomId}`);
      if (saved) {
        savedVisibleSlots = parseInt(saved, 10) || 1;
      }
    } catch (e) {}

    try {
      const saved = localStorage.getItem(`obs_settings_${roomId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          athleteInvites: parsed.athleteInvites || savedInvites,
          visibleSlotsCount: parsed.visibleSlotsCount ?? savedVisibleSlots,
        };
      }
    } catch (e) {}
    return {
      roomId,
      layout: "custom",
      logoUrl: defaultLogo, // Use the new VSC logo
      logoPosition: "top-right",
      logoSize: 12,
      bannerText: "GIẢI ĐẤU THỂ THAO ĐIỆN TỬ - VIỆT NAM",
      bannerBgColor: "#e11d48",
      bannerTextColor: "#ffffff",
      tickerText: "Chào mừng quý vị đang đến với Giải Đấu Kịch Tính! Hãy chuẩn bị tinh thần cho loạt trận hấp dẫn tiếp theo...",
      tickerSpeed: 18,
      showTicker: true,
      showBanner: true,
      backgroundStyle: "neon-cyber",
      highlightedClientId: "",
      showScoreboard: false,
      showIndividualScores: false,
      scoreboardTitle: "BẢNG XẾP HẠNG TRẬN ĐẤU",
      scoreboardEventName: "VÒNG LOẠI TRỰC TIẾP",
      scores: {},
      scoreNames: {},
      showLowerThirds: false,
      lowerThirdText: "Trực tiếp từ nhà thi đấu Quốc Gia",
      aspectRatio: "16:9",
      athleteInvites: savedInvites,
      visibleSlotsCount: savedVisibleSlots,
    };
  });

  const settingsRef = useRef<StreamSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
    try {
      localStorage.setItem(`obs_settings_${roomId}`, JSON.stringify(settings));
      if (settings.athleteInvites) {
        localStorage.setItem(`athlete_invites_${roomId}`, JSON.stringify(settings.athleteInvites));
      }
      if (settings.visibleSlotsCount !== undefined) {
        localStorage.setItem(`visible_slots_${roomId}`, settings.visibleSlotsCount.toString());
      }
    } catch (e) {}
  }, [settings, roomId]);

  // Track connected peers: Key: clientId
  const [connectedPeers, setConnectedPeers] = useState<Record<string, ConnectedPeer>>({});
  const connectedPeersRef = useRef<Record<string, ConnectedPeer>>({});
  useEffect(() => {
    connectedPeersRef.current = connectedPeers;
  }, [connectedPeers]);

  const handleCreateOfferToAthleteRef = useRef<any>(null);
  const handleCreateOfferToOBSRef = useRef<any>(null);

  // 4G mode toggle (Force TURN)
  const [use4GMode, setUse4GMode] = useState<boolean>(() => {
    return localStorage.getItem("webrtc_use_4g_mode") === "true";
  });
  const use4GModeRef = useRef<boolean>(localStorage.getItem("webrtc_use_4g_mode") === "true");
  useEffect(() => {
    use4GModeRef.current = use4GMode;
  }, [use4GMode]);

  const toggle4GMode = (val: boolean) => {
    setUse4GMode(val);
    use4GModeRef.current = val;
    localStorage.setItem("webrtc_use_4g_mode", String(val));
    console.log("[WebRTC Host] Toggled 4G Mode / Force TURN:", val);
    
    // Sync to OBS and other connected sources
    setSettings(prev => {
      const updated = { ...prev, use4GMode: val };
      syncSettingsToOBS(updated);
      return updated;
    });
    
    // Trigger recreation on all active peer connections to apply the new transport policy immediately
    Object.keys(peerConnectionsRef.current).forEach(targetId => {
      console.log(`[WebRTC Host] Destroying and recreating peer connection ${targetId} to apply 4G Mode...`);
      const pc = peerConnectionsRef.current[targetId];
      if (pc) {
        try {
          pc.onicecandidate = null;
          pc.onconnectionstatechange = null;
          pc.oniceconnectionstatechange = null;
          pc.ontrack = null;
          pc.close();
        } catch (e) {
          console.warn("Error closing pc on Host:", e);
        }
        delete peerConnectionsRef.current[targetId];
      }
      handleCreateOfferToAthlete(targetId);
    });
  };

  // Active remote camera list for each athlete
  const [athleteDevices, setAthleteDevices] = useState<Record<string, { deviceId: string; label: string }[]>>({});

  // Pre-configured athletes invitations (mirrored from settings for full OBS synchronization)
  const athleteInvites = settings.athleteInvites || [];
  const setAthleteInvites = (updater: { id: string; name: string }[] | ((prev: { id: string; name: string }[]) => { id: string; name: string }[])) => {
    setSettings(prev => {
      const currentInvites = prev.athleteInvites || [];
      const updatedInvites = typeof updater === "function" ? updater(currentInvites) : updater;
      const updated = {
        ...prev,
        athleteInvites: updatedInvites
      };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  const [newInviteName, setNewInviteName] = useState("");
  const [copiedInviteId, setCopiedInviteId] = useState("");

  const handleAddInvite = () => {
    if (!newInviteName.trim()) return;
    const newInvite = {
      id: "inv_" + Math.random().toString(36).substring(2, 8).toUpperCase(),
      name: newInviteName.trim()
    };
    setAthleteInvites(prev => [...prev, newInvite]);
    setNewInviteName("");
  };

  // Number of active visible slots for athletes (mirrored from settings for full OBS synchronization)
  const visibleSlotsCount = settings.visibleSlotsCount ?? 1;
  const setVisibleSlotsCount = (updater: number | ((prev: number) => number)) => {
    setSettings(prev => {
      const currentVisible = prev.visibleSlotsCount ?? 1;
      const updatedVisible = typeof updater === "function" ? updater(currentVisible) : updater;
      const updated = {
        ...prev,
        visibleSlotsCount: updatedVisible
      };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  const handleDeleteAthleteSlot = (index: number, athleteId?: string) => {
    if (athleteId) {
      console.log(`[Host Deletion] Kicking athlete ${athleteId} from slot ${index + 1}...`);
      sendRemoteControl(athleteId, "kick", true);
    }
    
    setSettings(prev => {
      const currentInvites = prev.athleteInvites || [];
      const updatedInvites = currentInvites.filter((_, i) => i !== index);
      const currentVisible = prev.visibleSlotsCount ?? 1;
      const updatedVisible = Math.max(1, currentVisible - 1);
      
      const updated = {
        ...prev,
        athleteInvites: updatedInvites,
        visibleSlotsCount: updatedVisible
      };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  // Outgoing Host/MC maximum bitrate setting (default 1000 kbps)
  const [hostBitrate, setHostBitrateState] = useState<number>(1000);
  const hostBitrateRef = useRef<number>(1000);

  // Athlete speed assignments (bitrate limits) (key: athleteId, value: kbps)
  const [athleteBitrates, setAthleteBitrates] = useState<Record<string, number>>({});

  const applySinglePcBitrate = async (pc: RTCPeerConnection, bitrateKbps: number) => {
    let targetBitrateKbps = bitrateKbps;
    let forceScaleDown = 1.0;

    // Detect if this peer connection corresponds to the OBS main/standard preview stream
    const peerId = Object.keys(peerConnectionsRef.current).find(k => peerConnectionsRef.current[k] === pc);
    const isMainObs = peerId === "obs" || (peerId && peerId.startsWith("obs") && !peerId.startsWith("obs_solo_"));

    if (isMainObs) {
      if (!mcCustomSettingsApplied) {
        // Drop preview quality of MC similar to athletes in the main OBS broadcast stream to conserve bandwidth
        targetBitrateKbps = 250;
        forceScaleDown = 2.0;
        console.log(`[Host] MC Custom settings not applied yet. Dynamic preview reduction active: ${targetBitrateKbps} kbps.`);
      }
    } else {
      // For connections directly to athletes or custom destinations, restrict standard limits if prioritized
      if (settings.bandwidthPriority === "vsc-overlay" || settings.bandwidthPriority === "solo-link") {
        targetBitrateKbps = Math.min(bitrateKbps, 400);
      }
    }

    const bitrateBps = targetBitrateKbps * 1000;
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === "video");
    if (videoSender) {
      try {
        const params = videoSender.getParameters();
        if (!params.encodings) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = bitrateBps;
        params.encodings[0].scaleResolutionDownBy = forceScaleDown;
        await videoSender.setParameters(params);
        console.log(`[Host] Applied dynamic maxBitrate of ${targetBitrateKbps} kbps and scale ${forceScaleDown} on peer connection ${peerId} (priority: ${settings.bandwidthPriority}).`);
      } catch (e) {
        console.warn("[Host] Failed to apply maxBitrate on peer connection:", e);
      }
    }
  };

  useEffect(() => {
    // Re-apply bitrate constraints to all active connections when priority or settings change
    (Object.values(peerConnectionsRef.current) as RTCPeerConnection[]).forEach(pc => {
      applySinglePcBitrate(pc, hostBitrateRef.current);
    });
  }, [settings.bandwidthPriority, mcCustomSettingsApplied]);

  const setHostBitrate = (val: number) => {
    setMcCustomSettingsApplied(true);
    setHostBitrateState(val);
    hostBitrateRef.current = val;
    // Apply to all existing connections
    (Object.values(peerConnectionsRef.current) as RTCPeerConnection[]).forEach(pc => {
      applySinglePcBitrate(pc, val);
    });
  };

  const handleRemoveInvite = (id: string) => {
    setAthleteInvites(prev => prev.filter(item => item.id !== id));
  };

  // WebRTC & connection Refs
  const wsRef = useRef<WebSocket | null>(null);
  const lastMessageTimeRef = useRef<number>(Date.now());
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIceCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  // Network Handover Recovery Queue
  const pendingMessagesRef = useRef<any[]>([]);

  const sendOrQueueSignalingMessage = (msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(msg));
      } catch (err) {
        console.error("[Host Dashboard] Error sending message, queuing instead:", err);
        pendingMessagesRef.current.push(msg);
      }
    } else {
      console.log("[Host Dashboard] WebSocket not open. Queuing message of type:", msg.type);
      pendingMessagesRef.current.push(msg);
    }
  };

// Helper to create a robust mock media stream for fallback when camera/mic is missing or blocked
function createMockMCStream(label: string = "HOST / MC SIMULATOR"): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  
  let angle = 0;
  function draw() {
    if (!ctx) return;
    
    // Background
    ctx.fillStyle = "#1e1b4b"; // Deep Indigo 950
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Aesthetic grid lines
    ctx.strokeStyle = "rgba(99, 102, 241, 0.15)";
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let j = 0; j < canvas.height; j += 40) {
      ctx.beginPath();
      ctx.moveTo(0, j);
      ctx.lineTo(canvas.width, j);
      ctx.stroke();
    }

    // Dynamic wave
    ctx.strokeStyle = "rgba(168, 85, 247, 0.4)"; // Purple
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += 10) {
      const y = canvas.height / 2 + Math.sin(x * 0.01 + angle) * 30;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Secondary cyan wave
    ctx.strokeStyle = "rgba(34, 211, 238, 0.3)"; // Cyan
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += 10) {
      const y = canvas.height / 2 + Math.cos(x * 0.015 - angle) * 20;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // HUD overlays
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(15, 15, canvas.width - 30, 65);
    ctx.strokeStyle = "rgba(99, 102, 241, 0.5)";
    ctx.strokeRect(15, 15, canvas.width - 30, 65);

    ctx.font = "bold 13px monospace";
    ctx.fillStyle = "#f43f5e"; // Rose
    ctx.fillText("● SYSTEM ONLINE (SIMULATED FEED)", 30, 38);
    
    ctx.font = "11px monospace";
    ctx.fillStyle = "#a5f3fc"; // Cyan-200
    ctx.fillText(`${label}`, 30, 56);
    ctx.fillText(`TIME: ${new Date().toLocaleTimeString()}  |  FPS: 30`, 30, 70);

    // Audio status bar
    ctx.fillStyle = "rgba(99, 102, 241, 0.2)";
    ctx.fillRect(canvas.width - 150, 30, 120, 10);
    const audioLevel = Math.abs(Math.sin(angle * 1.5)) * 120;
    ctx.fillStyle = "#10b981"; // Emerald
    ctx.fillRect(canvas.width - 150, 30, audioLevel, 10);
    ctx.font = "9px monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("MIC SIM", canvas.width - 150, 52);

    angle += 0.04;
    requestAnimationFrame(draw);
  }
  
  // Start drawing loop
  draw();

  // Create stream from canvas
  let stream: MediaStream;
  if ((canvas as any).captureStream) {
    stream = (canvas as any).captureStream(30);
  } else {
    stream = new MediaStream();
  }

  // Add dummy audio track using Web Audio API
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const destination = audioContext.createMediaStreamDestination();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = "sine";
    oscillator.frequency.value = 440;
    gainNode.gain.value = 0.001; // extremely quiet but present
    
    oscillator.connect(gainNode);
    gainNode.connect(destination);
    oscillator.start();
    
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (audioTrack) {
      stream.addTrack(audioTrack);
    }
  } catch (err) {
    console.warn("Could not create mock audio track", err);
  }

  return stream;
}

  useEffect(() => {
    async function getDevices() {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = devices.filter(d => d.kind === "videoinput");
          setHostDevices(videoDevs);
        } catch (e) {
          console.warn("Failed to enumerate devices for Host:", e);
        }
      }
    }
    getDevices();
  }, [localStream]);

  const updateMCStream = async (
    deviceId?: string,
    res?: "1080p" | "720p" | "480p" | "360p",
    zoom?: number
  ) => {
    const targetVideoDevice = deviceId !== undefined ? deviceId : hostSelectedVideo;
    const targetResolution = res !== undefined ? res : hostResolution;
    const targetZoom = zoom !== undefined ? zoom : hostZoom;

    let width = 854;
    let height = 480;
    if (targetResolution === "1080p") {
      width = 1920;
      height = 1080;
    } else if (targetResolution === "720p") {
      width = 1280;
      height = 720;
    } else if (targetResolution === "480p") {
      width = 854;
      height = 480;
    } else if (targetResolution === "360p") {
      width = 640;
      height = 360;
    }

    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 }
    };

    if (targetVideoDevice && targetVideoDevice !== "auto") {
      videoConstraints.deviceId = { exact: targetVideoDevice };
    }

    console.log("[Host Stream] Đang khởi động camera MC:", videoConstraints);

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: micActive
        });
      } catch (e1) {
        console.warn("[Host Stream] Failed Attempt 1, trying fallback:", e1);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: width },
              height: { ideal: height },
              frameRate: { ideal: 30 }
            },
            audio: true
          });
        } catch (e2) {
          console.warn("[Host Stream] Failed fallback, creating mock:", e2);
          stream = createMockMCStream("MC / TRỌNG TÀI CHÍNH (SIMULATED CAMERA)");
        }
      }

      // Apply hardware zoom if supported
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        try {
          const capabilities = videoTrack.getCapabilities?.() as any;
          if (capabilities && "zoom" in capabilities) {
            const minZoom = capabilities.zoom.min || 1.0;
            const maxZoom = capabilities.zoom.max || 4.0;
            const clampedZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));
            await videoTrack.applyConstraints({
              advanced: [{ zoom: clampedZoom } as any]
            });
            console.log(`[Host Stream] Hardware zoom applied successfully: ${clampedZoom}x`);
          }
        } catch (e) {
          console.warn("[Host Stream] Failed to apply hardware zoom:", e);
        }
      }

      // Stop old tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }

      setLocalStream(stream);
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      // Update tracks on all active peer connections smoothly
      const newVideoTrack = stream.getVideoTracks()[0];
      const newAudioTrack = stream.getAudioTracks()[0];

      for (const [peerId, pcVal] of Object.entries(peerConnectionsRef.current)) {
        const pc = pcVal as any;
        if (!pc || pc.connectionState === "closed") continue;
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === "video");
        const audioSender = senders.find(s => s.track && s.track.kind === "audio");

        if (videoSender && newVideoTrack) {
          await videoSender.replaceTrack(newVideoTrack).catch(e => console.warn("Failed replaceTrack video:", e));
        }
        if (audioSender && newAudioTrack) {
          await audioSender.replaceTrack(newAudioTrack).catch(e => console.warn("Failed replaceTrack audio:", e));
        }
      }

    } catch (err) {
      console.error("[Host Stream] Error updating MC stream:", err);
    }
  };

  // Capture MC Local Media Stream
  useEffect(() => {
    async function initMC() {
      await updateMCStream(hostSelectedVideo, hostResolution, hostZoom);
      connectSignaling();
    }
    initMC();

    return () => {
      // Shutdown tracks and signaling
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      wsRef.current?.close();
      (Object.values(peerConnectionsRef.current) as RTCPeerConnection[]).forEach(pc => pc.close());
    };
  }, []);

  // Proactive WebSocket reconnection guard for wake-from-sleep or mobile tab suspend
  useEffect(() => {
    const reacquireMCStreamIfUnhealthy = async (force = false) => {
      const currentStream = localStreamRef.current;
      const videoEl = localVideoRef.current;
      
      const hasTracks = currentStream && currentStream.getTracks().length > 0;
      const tracksLive = hasTracks && currentStream!.getTracks().every(track => track.readyState === "live" && !track.muted);
      
      // If we have a video element, check if it's successfully playing (readyState >= 2)
      // or if it is paused but has current time (meaning it has already loaded metadata/data).
      // If readyState is 0, it means it is completely frozen or hasn't started playing at all.
      const isVideoPlaying = !videoEl || (videoEl.readyState >= 2) || (videoEl.paused && videoEl.currentTime > 0);
      
      const isHealthy = tracksLive && isVideoPlaying;
      
      if (isHealthy && !force) return; // Stream and video are perfectly healthy
      
      console.warn(`[MEDIA_PIPELINE] Host MC camera stream or video element is unhealthy (tracksLive: ${tracksLive}, isVideoPlaying: ${isVideoPlaying}, force: ${force}). Re-acquiring getUserMedia...`);
      try {
        await updateMCStream(hostSelectedVideo, hostResolution, hostZoom);

        // Completely recreate and re-establish WebRTC connections for all active peers with the new tracks
        const pcs = { ...peerConnectionsRef.current };
        for (const [peerId, pcVal] of Object.entries(pcs)) {
          const pc = pcVal as any;
          if (!pc || pc.connectionState === "closed") continue;
          
          console.log(`[MEDIA_PIPELINE] MC camera re-acquired. Re-creating and re-establishing WebRTC connection with peer ${peerId} to guarantee video recovery...`);
          
          const peerMeta = connectedPeersRef.current[peerId];
          const isAthlete = peerMeta?.role === "athlete";
          
          if (isAthlete) {
            if (handleCreateOfferToAthleteRef.current) {
              handleCreateOfferToAthleteRef.current(peerId);
            }
          } else {
            if (handleCreateOfferToOBSRef.current) {
              handleCreateOfferToOBSRef.current(peerId);
            }
          }
        }
      } catch (err) {
        console.error("[MEDIA_PIPELINE] Failed to re-acquire Host camera stream:", err);
      }
    };

    const handleSyncReconnect = (e?: Event) => {
      const ws = wsRef.current;
      const now = Date.now();
      const lastMsg = lastMessageTimeRef.current;
      const isOnlineEvent = e && e.type === "online";
      const isZombie = ws && ws.readyState === WebSocket.OPEN && (now - lastMsg > 60000);
      const isStuckConnecting = ws && ws.readyState === WebSocket.CONNECTING && (now - lastMsg > 20000);
      
      // Force reconnect on actual network interface changes ('online' event)
      // because IP address has changed (e.g. WiFi -> 4G) and TCP socket is 100% dead.
      // Also reconnect if no WebSocket exists, it's CLOSED/CLOSING, or it's a zombie/stuck.
      if (isOnlineEvent || !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING || isZombie || isStuckConnecting) {
        console.log(`[Host Sync] Reconnect triggered (Event: ${e ? e.type : "sync"}, State: ${ws ? ws.readyState : "missing"}, isZombie: ${!!isZombie}, isStuckConnecting: ${!!isStuckConnecting}). Reconnecting...`);
        connectSignaling();
      }
    };

    const handleOnline = (e: Event) => handleSyncReconnect(e);
    const handleOthers = () => handleSyncReconnect();

    window.addEventListener("visibilitychange", handleOthers);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleOthers);

    // Periodic self-healing interval to catch silent/zombie drops
    const interval = setInterval(() => {
      handleSyncReconnect();
      reacquireMCStreamIfUnhealthy();
    }, 5000);

    return () => {
      window.removeEventListener("visibilitychange", handleOthers);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleOthers);
      clearInterval(interval);
    };
  }, []);

  // Keep local video feed in sync with current stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      const isNewAssignment = localVideoRef.current.srcObject !== localStream;
      if (isNewAssignment) {
        localVideoRef.current.srcObject = localStream;
        console.log(`[MEDIA_PIPELINE] [Host local video] srcObject ASSIGNED new stream. readyState: ${localVideoRef.current.readyState}`);
      }
    }
  }, [localStream]);

  // Periodic pipeline logger for video state, RTCRtpReceiver stats, and RTCRtpSender stats
  useEffect(() => {
    const logInterval = setInterval(async () => {
      console.log("=== [MEDIA_PIPELINE LOGGER (HOST)] START ===");

      // 5. Video elements
      const allVideoElements = document.querySelectorAll("video");
      allVideoElements.forEach((el, index) => {
        console.log(`[MEDIA_PIPELINE] [Video #${index}] srcObject Assigned: ${!!el.srcObject}, readyState: ${el.readyState}, videoWidth: ${el.videoWidth}, videoHeight: ${el.videoHeight}, className: "${el.className || ''}"`);
      });

      // 6 & 7. PeerConnection statistics
      const pcs = peerConnectionsRef.current;
      for (const [peerId, pcVal] of Object.entries(pcs)) {
        const pc = pcVal as any;
        if (!pc) continue;
        console.log(`[MEDIA_PIPELINE] [PC: ${peerId}] connectionState: ${pc.connectionState}, iceConnectionState: ${pc.iceConnectionState}, signalingState: ${pc.signalingState}`);
        
        try {
          const stats = await pc.getStats();
          stats.forEach(report => {
            const r = report as any;
            if (r.type === "inbound-rtp" && r.kind === "video") {
              console.log(`[MEDIA_PIPELINE] [Stats Inbound-RTP: ${peerId}] kind: video, bytesReceived: ${r.bytesReceived}, framesDecoded: ${r.framesDecoded}, framesDropped: ${r.framesDropped}`);
            }
            if (r.type === "outbound-rtp" && r.kind === "video") {
              console.log(`[MEDIA_PIPELINE] [Stats Outbound-RTP: ${peerId}] kind: video, bytesSent: ${r.bytesSent}, framesEncoded: ${r.framesEncoded}`);
            }
          });
        } catch (statsErr) {
          console.warn(`[MEDIA_PIPELINE] Failed to getStats for peer ${peerId}:`, statsErr);
        }
      }

      console.log("=== [MEDIA_PIPELINE LOGGER (HOST)] END ===");
    }, 4000);

    return () => clearInterval(logInterval);
  }, []);

  // Sync setting state changes to OBS in real-time
  const syncSettingsToOBS = (updatedSettings: StreamSettings) => {
    sendOrQueueSignalingMessage({
      type: "control-update",
      settings: updatedSettings
    });
  };

  // Connect to generic Signaling Server
  const connectSignaling = () => {
    // Deduplicate: Close existing connection if any before opening a new one
    if (wsRef.current) {
      console.log("[Signaling MC] Closing existing WebSocket before establishing a new one...");
      try {
        wsRef.current.onclose = null; // Detach onclose listener to avoid triggering redundant reconnection
        wsRef.current.onerror = null; // Detach onerror listener to avoid redundant logging of aborted connections
        wsRef.current.close();
      } catch (e) {
        console.warn("[Signaling MC] Error closing previous WebSocket:", e);
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/signaling?roomId=${roomId}&role=host&id=host&name=${encodeURIComponent(mcName)}`;
    
    console.log("[Signaling MC] Kết nối tới:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let pingInterval: any = null;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setWsConnected(true);
      lastMessageTimeRef.current = Date.now();
      console.log("[Signaling MC] WebSocket opened. Flushing pending messages queue...");
      
      // Synchronize initial layout to server
      sendOrQueueSignalingMessage({
        type: "control-update",
        settings: settings
      });

      // Setup keepalive ping heartbeat
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);

      // Flush pending queue
      const pending = pendingMessagesRef.current;
      pendingMessagesRef.current = [];
      for (const msg of pending) {
        try {
          ws.send(JSON.stringify(msg));
        } catch (e) {
          console.error("[Host Dashboard] Error flushing message, requeuing:", e);
          pendingMessagesRef.current.push(msg);
        }
      }
    };

    ws.onmessage = async (event) => {
      if (wsRef.current !== ws) return;
      lastMessageTimeRef.current = Date.now();
      try {
        const data = JSON.parse(event.data);
        console.log("[Signaling MC Received]", data.type, "từ", data.senderId);

        switch (data.type) {
          case "room-peers":
            // Restore saved settings from server if available (resilient layout protection)
            if (data.savedSettings) {
              console.log("[Signaling MC] Restoring persisted room settings from server:", data.savedSettings);
              setSettings(data.savedSettings);
            }
            // Register existing peers
            setConnectedPeers(prev => {
              const peersMap: Record<string, ConnectedPeer> = {};
              data.peers.forEach((peer: any) => {
                if (peer.id !== "host") {
                  const activePc = peerConnectionsRef.current[peer.id];
                  const isWebrtcHealthy = activePc && 
                    (activePc.connectionState === "connected" || activePc.iceConnectionState === "connected" || activePc.iceConnectionState === "completed");
                  
                  const existingPeer = prev[peer.id];
                  peersMap[peer.id] = { 
                    id: peer.id, 
                    name: peer.name, 
                    role: peer.role,
                    stream: existingPeer?.stream 
                  };
                  
                  // If is athlete, Host acts as coordinator: Always recreate fresh offer on room-peers (meaning Host joined/reconnected) to ensure a clean WebRTC path
                  if (peer.role === "athlete") {
                    if (activePc) {
                      console.log(`[Signaling MC] Host reconnected. Closing existing PC for Athlete ${peer.id} to ensure clean WebRTC state.`);
                      try { activePc.close(); } catch (e) {}
                      delete peerConnectionsRef.current[peer.id];
                    }
                    handleCreateOfferToAthlete(peer.id);
                  } else if (peer.role === "obs") {
                    console.log(`[Signaling MC] Host reconnected and found OBS peer ${peer.id}. Re-creating WebRTC offer and synchronizing current layout settings...`);
                    if (activePc) {
                      try { activePc.close(); } catch (e) {}
                      delete peerConnectionsRef.current[peer.id];
                    }
                    handleCreateOfferToOBS(peer.id);
                    sendOrQueueSignalingMessage({
                      type: "control-update",
                      targetId: peer.id,
                      settings: settingsRef.current
                    });
                  }
                }
              });
              return peersMap;
            });
            break;

          case "peer-connected":
            // New peer connected! Add to list
            setConnectedPeers(prev => {
              const updated = { ...prev };
              updated[data.senderId] = { id: data.senderId, name: data.name, role: data.role };
              return updated;
            });
            // Host sends Offer to newly joined Athlete
            if (data.role === "athlete") {
              console.log(`[Signaling MC] Athlete ${data.senderId} joined/reconnected. Creating fresh WebRTC offer.`);
              handleCreateOfferToAthlete(data.senderId);
              
              // Seed default points score for new athlete
              setSettings(prev => {
                const nextScores = { ...prev.scores };
                const nextNames = { ...prev.scoreNames };
                if (nextScores[data.senderId] === undefined) {
                  nextScores[data.senderId] = 0;
                }
                nextNames[data.senderId] = data.name;
                const nextSettings = { ...prev, scores: nextScores, scoreNames: nextNames };
                syncSettingsToOBS(nextSettings);
                return nextSettings;
              });
            } else if (data.role === "obs") {
              console.log(`[Signaling MC] OBS Renderer ${data.senderId} joined/reconnected. Re-creating WebRTC offer and synchronizing current layout settings...`);
              handleCreateOfferToOBS(data.senderId);
              sendOrQueueSignalingMessage({
                type: "control-update",
                targetId: data.senderId,
                settings: settingsRef.current
              });
            }
            break;

          case "control-update":
            if (data.settings) {
              console.log("[Signaling MC] Nhận cập nhật bố cục đồ họa từ thiết bị OBS:", data.settings);
              setSettings(data.settings);
            }
            break;

          case "request-stream":
            {
              // Check if sender is an athlete or OBS to initiate the correct WebRTC pipeline
              const senderPeer = connectedPeers[data.senderId];
              const isAthlete = data.senderRole === "athlete" || senderPeer?.role === "athlete";
              if (isAthlete) {
                console.log(`[Signaling MC] Athlete ${data.senderId} requested stream. Initiating WebRTC Offer to Athlete...`);
                handleCreateOfferToAthlete(data.senderId);
              } else {
                console.log(`[Signaling MC] OBS/Renderer ${data.senderId} requested stream. Initiating WebRTC Offer to OBS...`);
                handleCreateOfferToOBS(data.senderId);
              }
            }
            break;

          case "answer":
            // Handle Answer from Athlete or OBS
            const pc = peerConnectionsRef.current[data.senderId];
            if (pc) {
              if (pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
                // Process queued candidates
                const queue = (pc as any).iceCandidatesQueue;
                if (queue && queue.length > 0) {
                  for (const cand of queue) {
                    try {
                      await pc.addIceCandidate(new RTCIceCandidate(cand));
                    } catch (e) {
                      console.error("Lỗi áp dụng candidate từ hàng đợi:", e);
                    }
                  }
                  (pc as any).iceCandidatesQueue = [];
                }
              } else {
                console.warn(`[Host Dashboard] Nhận được Answer nhưng signalingState là ${pc.signalingState} (không phải have-local-offer). Bỏ qua để tránh lỗi.`);
              }
            }
            break;

          case "ice-candidate":
            if (data.candidate) {
              const pcCandidate = peerConnectionsRef.current[data.senderId];
              if (pcCandidate) {
                try {
                  if (pcCandidate.remoteDescription) {
                    await pcCandidate.addIceCandidate(new RTCIceCandidate(data.candidate));
                  } else {
                    if (!(pcCandidate as any).iceCandidatesQueue) {
                      (pcCandidate as any).iceCandidatesQueue = [];
                    }
                    (pcCandidate as any).iceCandidatesQueue.push(data.candidate);
                  }
                } catch (e) {
                  console.error("Lỗi addIceCandidate:", e);
                }
              } else {
                // Queue early candidates for when peer connection is created
                if (!pendingIceCandidatesRef.current[data.senderId]) {
                  pendingIceCandidatesRef.current[data.senderId] = [];
                }
                pendingIceCandidatesRef.current[data.senderId].push(data.candidate);
                console.log(`[Host] Queued early ICE candidate for peer ${data.senderId}`);
              }
            }
            break;

          case "camera-state":
            setConnectedPeers(prev => {
              const target = prev[data.senderId];
              if (target) {
                return {
                  ...prev,
                  [data.senderId]: {
                    ...target,
                    isMirrored: data.isMirrored
                  }
                };
              }
              return prev;
            });
            break;

          case "athlete-state-update":
            console.log("[Signaling MC] Nhận trạng thái cập nhật từ VĐV:", data.senderId, data);
            
            // Sync use4GMode (4G mode) setting
            if (data.use4GMode !== undefined) {
              setSlotUse4G(prev => ({
                ...prev,
                [data.senderId]: data.use4GMode
              }));
            }

            // Sync networkType (4G/5G or WIFI)
            if (data.networkType !== undefined) {
              setSlotNetworkType(prev => ({
                ...prev,
                [data.senderId]: data.networkType
              }));
            }

            // 1. Sync isMirrored and facingMode
            if (data.isMirrored !== undefined) {
              setConnectedPeers(prev => {
                const target = prev[data.senderId];
                if (target) {
                  return {
                    ...prev,
                    [data.senderId]: {
                      ...target,
                      isMirrored: data.isMirrored,
                      facingMode: data.facingMode
                    }
                  };
                }
                return prev;
              });
            }

            // 2. Sync mic (tắt mic / mở mic)
            if (data.micActive !== undefined) {
              setSlotMicMuted(prev => ({
                ...prev,
                [data.senderId]: !data.micActive
              }));
            }

            // 3. Sync cam active (tắt camera / mở camera)
            if (data.cameraActive !== undefined) {
              setSlotCamActive(prev => ({
                ...prev,
                [data.senderId]: data.cameraActive
              }));
            }

            // 4. Sync resolution (độ phân giải)
            if (data.resolution !== undefined) {
              setSlotRes(prev => ({
                ...prev,
                [data.senderId]: data.resolution
              }));
            }

            // 5. Sync zoomValue (zoom camera)
            if (data.zoomValue !== undefined) {
              setSlotZoom(prev => ({
                ...prev,
                [data.senderId]: data.zoomValue
              }));
            }

            // 6. Sync earphoneEnabled (tắt loa nghe)
            if (data.earphoneEnabled !== undefined) {
              setSlotSpeakerMuted(prev => ({
                ...prev,
                [data.senderId]: !data.earphoneEnabled
              }));
            }

            // 7. Sync selectedVideo camera device selection
            if (data.selectedVideo !== undefined) {
              setSlotSelectedVideo(prev => ({
                ...prev,
                [data.senderId]: data.selectedVideo
              }));
            }
            break;

          case "athlete-devices":
            setAthleteDevices(prev => ({
              ...prev,
              [data.senderId]: data.devices || []
            }));
            break;

          case "toggle-pip-request":
            togglePipPeer(data.senderId || data.value);
            break;

          case "peer-disconnected":
            console.log("[Signaling MC] Peer signaling ngắt kết nối:", data.senderId);
            {
              const activePc = peerConnectionsRef.current[data.senderId];
              const isWebrtcHealthy = activePc && 
                (activePc.connectionState === "connected" || activePc.iceConnectionState === "connected" || activePc.iceConnectionState === "completed");
              
              if (isWebrtcHealthy) {
                console.log(`[Signaling MC] WebRTC connection with ${data.senderId} is still healthy. Keeping video stream running!`);
              } else {
                console.log(`[Signaling MC] WebRTC connection with ${data.senderId} is inactive/dead. Cleaning up.`);
                if (activePc) {
                  try { activePc.close(); } catch (e) {}
                  delete peerConnectionsRef.current[data.senderId];
                }
                setConnectedPeers(prev => {
                  const copy = { ...prev };
                  delete copy[data.senderId];
                  return copy;
                });
              }
            }
            break;
        }
      } catch (err) {
        console.error("Lỗi phân tích gói tin:", err);
      }
    };

    ws.onerror = (err) => {
      if (wsRef.current !== ws) return;
      console.error("[Signaling MC] WebSocket error:", err);
      lastMessageTimeRef.current = Date.now();
      try {
        ws.close();
      } catch (e) {}
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) {
        console.log("[Signaling MC] Ignored close event for old/superseded WebSocket connection.");
        return;
      }
      setWsConnected(false);
      lastMessageTimeRef.current = Date.now();
      if (pingInterval) clearInterval(pingInterval);
      console.log("[Signaling MC] WebSocket closed. Tự kết nối lại...");
      setTimeout(() => {
        if (wsRef.current === ws && ws.readyState === WebSocket.CLOSED) {
          connectSignaling();
        }
      }, 3000);
    };
  };

  // MC/Host helper to handle connection failure
  const handleHostToAthleteFailure = (athleteId: string, pc: RTCPeerConnection) => {
    if ((pc as any).isReconnecting) return;
    (pc as any).isReconnecting = true;
    console.warn(`[Signaling MC] Kết nối tới Athlete ${athleteId} bị ngắt. Đang thử kết nối lại bằng ICE Restart...`);
    setTimeout(() => {
      if (peerConnectionsRef.current[athleteId] === pc) {
        (pc as any).isReconnecting = false;
        handleCreateOfferToAthlete(athleteId);
      }
    }, 250);
  };

  // Host initiates connection to Athlete (Adds local feed to send, receives Athlete camera on track)
  const handleCreateOfferToAthlete = async (athleteId: string) => {
    try {
      let oldPc = peerConnectionsRef.current[athleteId];
      if (oldPc) {
        console.log(`[Signaling MC] Closing and destroying old PeerConnection for Athlete ${athleteId} to ensure a clean state...`);
        try {
          oldPc.close();
        } catch (e) {}
        delete peerConnectionsRef.current[athleteId];
      }

      console.log(`[Signaling MC] Creating NEW RTCPeerConnection for Athlete ${athleteId}...`);
      const athleteUse4G = slotUse4GRef.current[athleteId] || use4GModeRef.current;
      const pc = new RTCPeerConnection(getWebRtcConfig(athleteUse4G));
      (pc as any).iceCandidatesQueue = [];
      peerConnectionsRef.current[athleteId] = pc;

      // Apply any early queued ICE candidates for this peer
      const earlyCandidates = pendingIceCandidatesRef.current[athleteId];
      if (earlyCandidates && earlyCandidates.length > 0) {
        console.log(`[Host] Applying ${earlyCandidates.length} queued early ICE candidates to new PC for Athlete ${athleteId}`);
        earlyCandidates.forEach(cand => {
          (pc as any).iceCandidatesQueue.push(cand);
        });
        delete pendingIceCandidatesRef.current[athleteId];
      }

      // Add local MC stream tracks to transmit to Athlete
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`[MEDIA_PIPELINE] [Host-to-Athlete] addTrack() track ID: ${track.id}, Kind: ${track.kind}, Label: ${track.label}`);
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Capture Athlete stream tracks
      pc.ontrack = (event) => {
        console.log(`[MEDIA_PIPELINE] [Host] ontrack() FIRED! Peer: ${athleteId}, Track ID: ${event.track.id}, Kind: ${event.track.kind}, Label: ${event.track.label}`);
        console.log(`[MEDIA_PIPELINE] [Host] ontrack() Number of streams:`, event.streams.length);
        
        console.log(`[Signaling MC] Đã thu được hình/âm thanh của VĐV ${athleteId}`);
        setConnectedPeers(prev => {
          // Robust check: if peer state is not yet in the map due to a race condition,
          // we initialize a skeleton PeerState instead of ignoring the track.
          const peer = prev[athleteId] || { id: athleteId, name: "Vận Động Viên", role: "athlete" };
          
          // Re-build a completely fresh MediaStream using only active tracks from the current connection
          const currentTracks = pc.getReceivers()
            .map(r => r.track)
            .filter(t => t && t.readyState === "live");
          
          if (currentTracks.length === 0 && event.streams[0]) {
            event.streams[0].getTracks().forEach(t => {
              if (t.readyState === "live") currentTracks.push(t);
            });
          }
          
          if (currentTracks.indexOf(event.track) === -1) {
            currentTracks.push(event.track);
          }

          const freshStream = new MediaStream();
          currentTracks.forEach(track => {
            freshStream.addTrack(track);
          });
          
          console.log(`[MEDIA_PIPELINE] [Host] Re-built clean MediaStream for Athlete ${athleteId} with ${currentTracks.length} live tracks.`);
          return {
            ...prev,
            [athleteId]: { ...peer, stream: freshStream }
          };
        });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendOrQueueSignalingMessage({
            type: "ice-candidate",
            candidate: event.candidate,
            targetId: athleteId
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[MC-to-Athlete ${athleteId}] Connection State:`, pc.connectionState);
        if (pc.connectionState === "connected") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          applySinglePcBitrate(pc, hostBitrateRef.current);
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          handleHostToAthleteFailure(athleteId, pc);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[MC-to-Athlete ${athleteId}] ICE State:`, pc.iceConnectionState);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          applySinglePcBitrate(pc, hostBitrateRef.current);
        } else if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          handleHostToAthleteFailure(athleteId, pc);
        }
      };

      const offerOptions: RTCOfferOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      };

      const offer = await pc.createOffer(offerOptions);
      let offerSdp = offer.sdp || "";
      if (offerSdp) {
        offerSdp = preferH264(offerSdp);
        const hasVideo = offerSdp.includes("m=video");
        const hasSendRecv = offerSdp.includes("a=sendrecv") || offerSdp.includes("a=sendonly") || offerSdp.includes("a=recvonly");
        console.log(`[MEDIA_PIPELINE] [Host-to-Athlete ${athleteId}] SDP VERIFICATION (H264 Preferred): m=video exists: ${hasVideo}, sendrecv/sendonly/recvonly exists: ${hasSendRecv}`);
      } else {
        console.warn(`[MEDIA_PIPELINE] [Host-to-Athlete ${athleteId}] SDP is undefined!`);
      }
      await pc.setLocalDescription(new RTCSessionDescription({ type: "offer", sdp: offerSdp }));

      sendOrQueueSignalingMessage({
        type: "offer",
        sdp: offerSdp,
        targetId: athleteId
      });

    } catch (err) {
      console.error(`Lỗi bắt tay WebRTC tới Athlete ${athleteId}:`, err);
    }
  };

  // Host initiates connection to OBS (OBS is receiver only, Host only sends local tracks)
  const handleCreateOfferToOBS = async (obsId: string) => {
    try {
      const oldPc = peerConnectionsRef.current[obsId];
      if (oldPc) {
        oldPc.close();
      }

      const pc = new RTCPeerConnection(getWebRtcConfig(use4GModeRef.current));
      (pc as any).iceCandidatesQueue = [];
      peerConnectionsRef.current[obsId] = pc;

      // Apply any early queued ICE candidates for this peer
      const earlyCandidates = pendingIceCandidatesRef.current[obsId];
      if (earlyCandidates && earlyCandidates.length > 0) {
        console.log(`[Host] Applying ${earlyCandidates.length} queued early ICE candidates to new PC for OBS ${obsId}`);
        earlyCandidates.forEach(cand => {
          (pc as any).iceCandidatesQueue.push(cand);
        });
        delete pendingIceCandidatesRef.current[obsId];
      }

      // Add local track to OBS
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`[MEDIA_PIPELINE] [Host-to-OBS] addTrack() track ID: ${track.id}, Kind: ${track.kind}, Label: ${track.label}`);
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendOrQueueSignalingMessage({
            type: "ice-candidate",
            candidate: event.candidate,
            targetId: obsId
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          applySinglePcBitrate(pc, hostBitrateRef.current);
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          if ((pc as any).isReconnecting) return;
          (pc as any).isReconnecting = true;
          console.warn(`[Signaling MC] Kết nối tới OBS ${obsId} bị ngắt/thất bại (${pc.connectionState}). Đang thử kết nối lại...`);
          setTimeout(() => {
            if (peerConnectionsRef.current[obsId] === pc) {
              handleCreateOfferToOBS(obsId);
            }
          }, 250);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Signaling MC-to-OBS ${obsId}] ICE State:`, pc.iceConnectionState);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          applySinglePcBitrate(pc, hostBitrateRef.current);
        } else if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          if ((pc as any).disconnectTimeout) {
            clearTimeout((pc as any).disconnectTimeout);
            (pc as any).disconnectTimeout = null;
          }
          if ((pc as any).isReconnecting) return;
          (pc as any).isReconnecting = true;
          console.warn(`[Signaling MC] ICE tới OBS ${obsId} bị ngắt/thất bại (${pc.iceConnectionState}). Đang thử kết nối lại...`);
          setTimeout(() => {
            if (peerConnectionsRef.current[obsId] === pc) {
              handleCreateOfferToOBS(obsId);
            }
          }, 250);
        }
      };

      const offer = await pc.createOffer();
      let offerSdp = offer.sdp || "";
      if (offerSdp) {
        offerSdp = preferH264(offerSdp);
        const hasVideo = offerSdp.includes("m=video");
        const hasSendRecv = offerSdp.includes("a=sendrecv") || offerSdp.includes("a=sendonly") || offerSdp.includes("a=recvonly");
        console.log(`[MEDIA_PIPELINE] [Host-to-OBS ${obsId}] SDP VERIFICATION (H264 Preferred): m=video exists: ${hasVideo}, sendrecv/sendonly/recvonly exists: ${hasSendRecv}`);
      } else {
        console.warn(`[MEDIA_PIPELINE] [Host-to-OBS ${obsId}] SDP is undefined!`);
      }
      await pc.setLocalDescription(new RTCSessionDescription({ type: "offer", sdp: offerSdp }));

      sendOrQueueSignalingMessage({
        type: "offer",
        sdp: offerSdp,
        targetId: obsId
      });

    } catch (err) {
      console.error(`Lỗi bắt tay WebRTC tới OBS ${obsId}:`, err);
    }
  };

  handleCreateOfferToAthleteRef.current = handleCreateOfferToAthlete;
  handleCreateOfferToOBSRef.current = handleCreateOfferToOBS;

  // MC Camera toggle
  const toggleCamera = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setCameraActive(track.enabled);
      }
    }
  };

  // MC Mic toggle
  const toggleMic = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setMicActive(track.enabled);
      }
    }
  };

  // Scoreboard Point Changer Helpers
  const changeScore = (clientId: string, offset: number) => {
    setSettings(prev => {
      const nextScores = { ...prev.scores };
      const current = nextScores[clientId] || 0;
      nextScores[clientId] = Math.max(0, current + offset);
      const updated = { ...prev, scores: nextScores };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  // Confetti VFX Trigger
  const triggerConfettiVFX = () => {
    sendOrQueueSignalingMessage({
      type: "trigger-vfx",
      name: "confetti"
    });
  };

  // Copy OBS URL Helper
  const copyObsLinkToClipboard = () => {
    const link = `${window.location.origin}/?role=obs&roomId=${roomId}`;
    navigator.clipboard.writeText(link);
    setCopiedObsLink(true);
    setTimeout(() => setCopiedObsLink(false), 2000);
  };

  const copySoloObsLinkToClipboard = (athleteId: string) => {
    const link = `${window.location.origin}/?role=obs&roomId=${roomId}&solo=${athleteId}`;
    navigator.clipboard.writeText(link);
    setCopiedSoloObsId(athleteId);
    setTimeout(() => setCopiedSoloObsId(null), 2000);
  };

  const updateSettingField = <K extends keyof StreamSettings>(key: K, value: StreamSettings[K]) => {
    setSettings(prev => {
      const updated = { ...prev, [key]: value };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  const updateCameraTransform = (peerId: string, type: "rotation" | "aspect" | "fit", value: any) => {
    setSettings(prev => {
      const nextRotations = { ...prev.cameraRotations || {} };
      const nextAspects = { ...prev.cameraAspects || {} };
      const nextFits = { ...prev.cameraFits || {} };

      if (type === "rotation") {
        nextRotations[peerId] = value;
      } else if (type === "aspect") {
        nextAspects[peerId] = value;
      } else if (type === "fit") {
        nextFits[peerId] = value;
      }

      const updated = {
        ...prev,
        cameraRotations: nextRotations,
        cameraAspects: nextAspects,
        cameraFits: nextFits
      };
      
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  const togglePeerVisibility = (peerId: string) => {
    setSettings(prev => {
      const hidden = { ...prev.hiddenPeers || {} };
      hidden[peerId] = !hidden[peerId];
      const updated = { ...prev, hiddenPeers: hidden };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  const togglePipPeer = (peerId: string) => {
    setSettings(prev => {
      const pips = { ...prev.pipPeers || {} };
      pips[peerId] = !pips[peerId];
      const updated = { ...prev, pipPeers: pips };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  const movePeerOrder = (peerId: string, direction: "up" | "down") => {
    setSettings(prev => {
      const activeIds = [
        "host",
        ...(Object.values(connectedPeers) as ConnectedPeer[])
          .filter(p => p.role === "athlete")
          .map(p => p.id)
      ];

      let currentOrder = prev.peerOrder ? [...prev.peerOrder] : [];
      currentOrder = currentOrder.filter(id => activeIds.includes(id));
      activeIds.forEach(id => {
        if (!currentOrder.includes(id)) {
          currentOrder.push(id);
        }
      });

      const index = currentOrder.indexOf(peerId);
      if (index === -1) return prev;

      if (direction === "up" && index < currentOrder.length - 1) {
        const temp = currentOrder[index];
        currentOrder[index] = currentOrder[index + 1];
        currentOrder[index + 1] = temp;
      } else if (direction === "down" && index > 0) {
        const temp = currentOrder[index];
        currentOrder[index] = currentOrder[index - 1];
        currentOrder[index - 1] = temp;
      }

      const updated = { ...prev, peerOrder: currentOrder };
      syncSettingsToOBS(updated);
      return updated;
    });
  };

  // Count active athletes
  const activeAthletesList = (Object.values(connectedPeers) as ConnectedPeer[]).filter(p => p.role === "athlete");
  const activeObsList = (Object.values(connectedPeers) as ConnectedPeer[]).filter(p => p.role === "obs");

  // Athlete slot remote control states
  const [openSlotSettings, setOpenSlotSettings] = useState<Record<number, boolean>>({});
  const [slotMicMuted, setSlotMicMuted] = useState<Record<string, boolean>>({});
  const [slotCamActive, setSlotCamActive] = useState<Record<string, boolean>>({});
  const [slotSpeakerMuted, setSlotSpeakerMuted] = useState<Record<string, boolean>>({});
  const [slotSelectedVideo, setSlotSelectedVideo] = useState<Record<string, string>>({});
  const [slotRes, setSlotRes] = useState<Record<string, "1080p" | "720p" | "480p">>({});
  const [slotZoom, setSlotZoom] = useState<Record<string, number>>({});
  const [slotVolume, setSlotVolume] = useState<Record<string, number>>({});
  const [slotMixOrder, setSlotMixOrder] = useState<Record<string, number>>({});
  const [slotSelectedScene, setSlotSelectedScene] = useState<Record<string, string>>({});
  const [slotSelectedCamMix, setSlotSelectedCamMix] = useState<Record<string, string>>({});
  const [slotSelectedGain, setSlotSelectedGain] = useState<Record<string, string>>({});
  const [slotUse4G, setSlotUse4G] = useState<Record<string, boolean>>({});
  const slotUse4GRef = useRef<Record<string, boolean>>({});
  const [slotNetworkType, setSlotNetworkType] = useState<Record<string, string>>({});
  useEffect(() => {
    slotUse4GRef.current = slotUse4G;
  }, [slotUse4G]);

  // Send WebSocket remote-control signal to target athlete
  const sendRemoteControl = (athleteId: string, action: string, value: any) => {
    sendOrQueueSignalingMessage({
      type: "remote-control",
      targetId: athleteId,
      action,
      value
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Upper Status Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center">
            <img 
              src="https://lh3.googleusercontent.com/d/1CAz9xUSO8XIvtEy9TYqil228Cz-jYcIM" 
              referrerPolicy="no-referrer"
              alt="Brand Logo" 
              className="h-8 w-auto object-contain"
            />
          </div>
          <div>
            <span className="text-[10px] text-purple-400 font-mono uppercase tracking-widest font-bold">STUDIO ĐIỀU PHỐI CHƯƠNG TRÌNH</span>
            <div className="flex items-center gap-2 mt-0.5">
              <h2 className="text-base font-black tracking-tight font-mono text-white">MÃ PHÒNG HOẠT ĐỘNG:</h2>
              <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-sm font-mono font-bold text-amber-400 tracking-wider select-all uppercase">
                {roomId}
              </span>
            </div>
          </div>
        </div>

        {/* Remote VSC link block */}
        <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono">
          <span className="text-slate-400">VSC LINK OVERLAY:</span>
          <button 
            onClick={copyObsLinkToClipboard}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer transition-all active:scale-95"
          >
            {copiedObsLink ? <Check className="h-3 w-3 text-emerald-300 stroke-[3]" /> : <Copy className="h-3 w-3" />}
            <span>{copiedObsLink ? "ĐÃ SAO CHÉP" : "COPY"}</span>
          </button>
        </div>

        {/* Telemetry Indicator */}
        <div className="flex items-center gap-4 text-xs font-mono">
          {/* 4G Mode Toggle */}
          <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-lg">
            <span className="text-[10px] font-bold text-slate-300">CHẾ ĐỘ MẠNG 4G:</span>
            <button
              onClick={() => toggle4GMode(!use4GMode)}
              className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${use4GMode ? "bg-cyan-500" : "bg-slate-800"}`}
              title="Kích hoạt chế độ 4G / Ép đi qua TURN Relay"
            >
              <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ${use4GMode ? "translate-x-4" : "translate-x-0"}`} />
            </button>
            <span className={`text-[10px] font-bold ${use4GMode ? "text-cyan-400" : "text-slate-500"}`}>
              {use4GMode ? "BẬT" : "TẮT"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 border-l border-slate-800 pl-4">
            <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-red-500 animate-pulse"}`} />
            <span className="text-slate-400">SIGNALING PORTAL</span>
          </div>
          <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3 text-[11px]">
            <span className="text-emerald-400 font-bold">{activeAthletesList.length} VĐV</span>
            <span className="text-slate-600">/</span>
            <span className="text-purple-400 font-bold">{activeObsList.length} OBS SOURCE</span>
          </div>
        </div>
      </header>

      {/* Main Studio Console Grid */}
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 p-6 items-stretch">
        
        {/* Left Side (MC Cam + Athlete Monitor feeds): col-span-5 */}
        <div className="xl:col-span-5 flex flex-col gap-6">
          
          {/* TỔNG OUTPUT (Xem trước của toàn Broadcast) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-2 gap-2">
              <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <Tv className="h-4 w-4 text-purple-400 animate-pulse" />
                <span>TỔNG OUTPUT (XEM TRƯỚC TOÀN BỘ BROADCAST)</span>
              </span>
              <span className="text-[10px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded uppercase font-mono self-start md:self-auto">
                {settings.aspectRatio || "16:9"} Output
              </span>
            </div>

            {/* Bandwidth Priority Optimization Selector */}
            <div className="bg-slate-950/80 border border-slate-800/60 rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold font-mono text-cyan-400 flex items-center gap-1">
                  ⚡ PHÂN PHỐI BĂNG THÔNG LIVE
                </span>
                <span className="text-[8px] text-slate-400 font-mono">
                  Bật/tắt kênh phân phối. Khi bật 1 kênh, kênh còn lại sẽ tự động tắt để tối ưu hóa băng thông.
                </span>
              </div>
              <div className="flex items-center gap-4">
                {/* Switch 1: VSC OVERLAY */}
                <div className="flex items-center gap-2 bg-slate-900 px-2 py-1 rounded border border-slate-800/80">
                  <span className="text-[9px] font-mono font-bold text-slate-300">VSC OVERLAY:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const current = settings.bandwidthPriority || "vsc-overlay";
                      const next = current === "vsc-overlay" ? "none" as const : "vsc-overlay" as const;
                      const updated = { ...settings, bandwidthPriority: next };
                      setSettings(updated);
                      syncSettingsToOBS(updated);
                    }}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      (settings.bandwidthPriority || "vsc-overlay") === "vsc-overlay" ? "bg-cyan-500" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        (settings.bandwidthPriority || "vsc-overlay") === "vsc-overlay" ? "translate-x-3.5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Switch 2: SOLO LINK */}
                <div className="flex items-center gap-2 bg-slate-900 px-2 py-1 rounded border border-slate-800/80">
                  <span className="text-[9px] font-mono font-bold text-slate-300">SOLO LINK:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const current = settings.bandwidthPriority;
                      const next = current === "solo-link" ? "none" as const : "solo-link" as const;
                      const updated = { ...settings, bandwidthPriority: next };
                      setSettings(updated);
                      syncSettingsToOBS(updated);
                    }}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      settings.bandwidthPriority === "solo-link" ? "bg-emerald-500" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.bandwidthPriority === "solo-link" ? "translate-x-3.5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
            
            <div className={`bg-slate-950 rounded-lg overflow-hidden relative border border-slate-800/60 transition-all duration-300 ${
              settings.aspectRatio === "9:16" ? "aspect-[9/16] max-h-[350px] mx-auto" : "aspect-video"
            }`}>
              {(() => {
                const combinedStreams: Record<string, { id: string; name: string; role: "host" | "athlete" | "obs"; stream?: MediaStream; isMirrored?: boolean }> = {};
                
                // MC local stream
                if (localStream) {
                  combinedStreams["host"] = {
                    id: "host",
                    name: "MC Ban Tổ Chức",
                    role: "host",
                    stream: localStream,
                    isMirrored: false
                  };
                }
                
                // Athlete streams
                Object.values(connectedPeers).forEach((peer: ConnectedPeer) => {
                  combinedStreams[peer.id] = {
                    id: peer.id,
                    name: peer.name,
                    role: peer.role === "obs" ? "obs" : "athlete",
                    stream: peer.stream,
                    isMirrored: peer.isMirrored
                  };
                });
                
                return (
                  <ObsRenderer 
                    roomId={roomId} 
                    isPreview={true} 
                    settings={settings}
                    localStreams={combinedStreams}
                    onUpdateSettings={(updated, isCommit) => {
                      setSettings(updated);
                      if (isCommit !== false) {
                        syncSettingsToOBS(updated);
                      }
                    }}
                  />
                );
              })()}
            </div>
          </div>

          {/* 3. Realtime Point Counter & Scoreboard (Moved between TOTAL OUTPUT and MC MONITOR) */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
              <div className="flex items-center gap-2">
                <Trophy className="h-4.5 w-4.5 text-yellow-400" />
                <span className="text-[10px] text-slate-300 font-mono uppercase tracking-wider font-bold">4. BẢNG ĐIỂM SỐ & THI ĐẤU THỜI GIAN THỰC</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setScoreboardSettingsCollapsed(!scoreboardSettingsCollapsed)}
                  className="flex items-center gap-1.5 text-[9px] font-mono bg-slate-900 hover:bg-slate-800 text-slate-300 px-2 py-1 rounded cursor-pointer border border-slate-800 font-bold transition-all"
                >
                  {scoreboardSettingsCollapsed ? "⚙️ HIỆN CÀI ĐẶT" : "⚙️ ẨN CÀI ĐẶT"}
                </button>
                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2">
                  <span className="text-[10px] text-slate-400 font-mono">BẢNG LỚN:</span>
                  <input 
                    type="checkbox" 
                    checked={settings.showScoreboard} 
                    onChange={(e) => updateSettingField("showScoreboard", e.target.checked)}
                    className="cursor-pointer accent-purple-500 h-3.5 w-3.5"
                  />
                </div>
                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2">
                  <span className="text-[10px] text-slate-400 font-mono">BẢNG ĐIỂM TRÊN KHUNG HÌNH:</span>
                  <input 
                    type="checkbox" 
                    checked={settings.showIndividualScores || false} 
                    onChange={(e) => updateSettingField("showIndividualScores", e.target.checked)}
                    className="cursor-pointer accent-cyan-500 h-3.5 w-3.5"
                  />
                </div>
              </div>
            </div>

            {/* Interactive Point manipulators per athlete - PLACED AT THE TOP */}
            <div className="space-y-2 pt-1">
              <span className="text-[9px] text-slate-400 font-mono block uppercase">Bảng điều khiển điểm nhanh của VĐV:</span>
              {activeAthletesList.length === 0 ? (
                <span className="text-[10px] text-slate-600 font-mono block">Chưa có VĐV kết nối để tính điểm số...</span>
              ) : (
                <div className="space-y-2">
                  {activeAthletesList.map((athlete) => {
                    const score = settings.scores[athlete.id] || 0;
                    const customName = settings.scoreNames[athlete.id] || athlete.name;
                    return (
                      <div key={athlete.id} className="flex items-center justify-between bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-cyan-400" />
                          <input 
                            type="text"
                            value={customName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSettings(prev => {
                                const copy = { ...prev.scoreNames };
                                copy[athlete.id] = val;
                                const next = { ...prev, scoreNames: copy };
                                syncSettingsToOBS(next);
                                return next;
                              });
                            }}
                            className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-cyan-500 text-xs text-white font-bold px-1 py-0.5 outline-none font-mono"
                            placeholder="Đổi tên hiển thị bảng điểm..."
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Copy Solo VSC Button */}
                          <button
                            onClick={() => copySoloObsLinkToClipboard(athlete.id)}
                            className={`px-2 py-1 rounded text-[10px] font-mono font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                              copiedSoloObsId === athlete.id 
                                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400" 
                                : "bg-purple-600/10 hover:bg-purple-600/20 border-purple-500/20 text-purple-400 hover:text-purple-300"
                            }`}
                            title="Copy Solo VSC browser overlay link"
                          >
                            <Copy className="h-2.5 w-2.5" />
                            <span>{copiedSoloObsId === athlete.id ? "COPIED VSC" : "SOLO VSC"}</span>
                          </button>

                          {/* Minus Button */}
                          <button
                            onClick={() => changeScore(athlete.id, -1)}
                            className="h-7 w-7 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center justify-center cursor-pointer font-bold active:scale-90"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>

                          {/* Active Score display */}
                          <span className="text-sm font-black font-mono bg-slate-950 px-3 py-1 rounded border border-slate-800 text-amber-400 min-w-[40px] text-center">
                            {score}
                          </span>

                          {/* Plus Button */}
                          <button
                            onClick={() => changeScore(athlete.id, 1)}
                            className="h-7 w-7 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded flex items-center justify-center cursor-pointer font-bold active:scale-90"
                          >
                            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Conditional Settings Section - PLACED AT THE BOTTOM */}
            {!scoreboardSettingsCollapsed && (
              <>
                {/* Title & description editors */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-900 pt-3">
                  <div>
                    <label className="text-[9px] text-slate-500 font-mono uppercase">TIÊU ĐỀ BẢNG ĐIỂM</label>
                    <input 
                      type="text" 
                      value={settings.scoreboardTitle}
                      onChange={(e) => updateSettingField("scoreboardTitle", e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 text-xs rounded px-2 py-1 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 font-mono uppercase">GIAI ĐOẠN / TÊN TRẬN</label>
                    <input 
                      type="text" 
                      value={settings.scoreboardEventName}
                      onChange={(e) => updateSettingField("scoreboardEventName", e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 text-xs rounded px-2 py-1 text-white outline-none"
                    />
                  </div>
                </div>

                {/* Display Customization Sliders (Scoreboard Blur & Badge Opacity) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/40 p-3 rounded-lg border border-slate-800/80">
                  <div>
                    <div className="flex justify-between items-center mb-0.5">
                      <label className="text-[9px] text-slate-400 font-mono uppercase">ĐỘ MỜ NỀN BẢNG LỚN</label>
                      <span className="text-[9px] text-cyan-400 font-bold">{settings.scoreboardBgOpacity !== undefined ? settings.scoreboardBgOpacity : 80}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={settings.scoreboardBgOpacity !== undefined ? settings.scoreboardBgOpacity : 80}
                      onChange={(e) => updateSettingField("scoreboardBgOpacity", parseInt(e.target.value))}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 mt-2"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-0.5">
                      <label className="text-[9px] text-slate-400 font-mono uppercase font-bold text-amber-400">ĐỘ BLUR NỀN BẢNG LỚN</label>
                      <span className="text-[9px] text-amber-400 font-bold">{settings.scoreboardBgBlur !== undefined ? settings.scoreboardBgBlur : 12}px</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="24" 
                      value={settings.scoreboardBgBlur !== undefined ? settings.scoreboardBgBlur : 12}
                      onChange={(e) => updateSettingField("scoreboardBgBlur", parseInt(e.target.value))}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 mt-2"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-0.5">
                      <label className="text-[9px] text-slate-400 font-mono uppercase font-bold text-cyan-400">ĐỘ MỜ BẢNG TRÊN KHUNG HÌNH</label>
                      <span className="text-[9px] text-cyan-400 font-bold">{settings.scoreBadgeBgOpacity !== undefined ? settings.scoreBadgeBgOpacity : 90}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={settings.scoreBadgeBgOpacity !== undefined ? settings.scoreBadgeBgOpacity : 90}
                      onChange={(e) => updateSettingField("scoreBadgeBgOpacity", parseInt(e.target.value))}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 mt-2"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* MC Monitor (Camera Giám Sát Của MC) - Compact */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-[11px] font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 text-purple-400" />
                <span>CAMERA GIÁM SÁT CỦA MC (SENDER)</span>
              </span>
              <span className="text-[9px] bg-purple-500/10 border border-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded uppercase font-mono">MC/Host</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              {/* Compact Video Box (Optimized Status Only) */}
              <div className="md:col-span-4 bg-slate-950 rounded-lg overflow-hidden relative border border-slate-800/60 aspect-video w-full flex flex-col items-center justify-center p-3 select-none">
                <div className={`h-2.5 w-2.5 rounded-full ${cameraActive && localStream ? "bg-emerald-500 animate-pulse" : "bg-rose-500"} mb-1`} />
                <span className={`text-[10px] font-mono font-bold ${cameraActive && localStream ? "text-emerald-400" : "text-rose-400"}`}>
                  {cameraActive && localStream ? "● SENDER ONLINE" : "● OFFLINE"}
                </span>
                <span className="text-[7.5px] text-slate-500 font-mono uppercase tracking-wider mt-0.5 text-center">
                  BĂNG THÔNG TỐI ƯU (CHỈ HIỂN THỊ TRẠNG THÁI)
                </span>
                
                {/* Keep a hidden video element to maintain WebRTC video track activation if needed */}
                {localStream && (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="hidden"
                  />
                )}
              </div>

              {/* Controls and stream modifications */}
              <div className="md:col-span-8 flex flex-col space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-mono">MC: <strong className="text-white">{mcName}</strong></span>
                  
                  {/* Toggle Audio/Video */}
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => togglePeerVisibility("host")}
                      className={`px-1.5 py-1 rounded border text-[8px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer ${
                        settings.hiddenPeers?.["host"] 
                          ? "bg-rose-500/15 border-rose-500/30 text-rose-400" 
                          : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      }`}
                      title="Ẩn/Hiện MC trên Tổng Output"
                    >
                      {settings.hiddenPeers?.["host"] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      <span>{settings.hiddenPeers?.["host"] ? "ĐÃ ẨN" : "HIỂN THỊ"}</span>
                    </button>
                    <button 
                      onClick={() => togglePipPeer("host")}
                      className={`px-1.5 py-1 rounded border text-[8px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer ${
                        settings.pipPeers?.["host"] 
                          ? "bg-purple-500 text-white border-purple-500" 
                          : "bg-slate-900 border-slate-800 text-slate-300"
                      }`}
                      title="Chuyển MC thành PIP tròn"
                    >
                      <span>⭕ {settings.pipPeers?.["host"] ? "PIP ON" : "PIP OFF"}</span>
                    </button>
                    <button 
                      onClick={toggleCamera}
                      className={`p-1.5 rounded border transition-all ${cameraActive ? "bg-purple-600/10 border-purple-500/20 text-purple-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"}`}
                      title="Bật/Tắt Camera"
                    >
                      {cameraActive ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                    </button>
                    <button 
                      onClick={toggleMic}
                      className={`p-1.5 rounded border transition-all ${micActive ? "bg-purple-600/10 border-purple-500/20 text-purple-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"}`}
                      title="Bật/Tắt Mic"
                    >
                      {micActive ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Sub-controls: Rotation, Aspect, Fit */}
                <div className="grid grid-cols-3 gap-1.5 text-[8px] font-mono text-slate-400">
                  {/* Aspect */}
                  <div className="space-y-0.5">
                    <span className="block text-slate-500 font-bold">TỈ LỆ CAM</span>
                    <div className="flex gap-0.5">
                      {(["16:9", "9:16"] as const).map(asp => (
                        <button
                          key={asp}
                          onClick={() => updateCameraTransform("host", "aspect", asp)}
                          className={`px-1 py-0.5 rounded text-[7px] font-bold cursor-pointer flex-1 text-center border transition-all ${
                            (settings.cameraAspects?.["host"] ?? "16:9") === asp
                              ? "bg-purple-500/20 border-purple-500/80 text-purple-300 font-black"
                              : "bg-slate-950 border-slate-850 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {asp}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotation */}
                  <div className="space-y-0.5">
                    <span className="block text-slate-500 font-bold">XOAY CAM</span>
                    <div className="flex gap-0.5 overflow-x-auto">
                      {([0, 90, 180, 270] as const).map(deg => (
                        <button
                          key={deg}
                          onClick={() => updateCameraTransform("host", "rotation", deg)}
                          className={`px-0.5 py-0.5 rounded text-[7px] font-bold cursor-pointer flex-1 text-center border transition-all ${
                            (settings.cameraRotations?.["host"] ?? 0) === deg
                              ? "bg-purple-500/20 border-purple-500/80 text-purple-300 font-black"
                              : "bg-slate-950 border-slate-850 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {deg}°
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Fit */}
                  <div className="space-y-0.5">
                    <span className="block text-slate-500 font-bold">DẠNG FIT</span>
                    <div className="flex gap-0.5">
                      {(["cover", "contain"] as const).map(ft => (
                        <button
                          key={ft}
                          onClick={() => updateCameraTransform("host", "fit", ft)}
                          className={`px-1 py-0.5 rounded text-[7px] font-bold cursor-pointer flex-1 text-center border transition-all ${
                            (settings.cameraFits?.["host"] ?? "cover") === ft
                              ? "bg-purple-500/20 border-purple-500/80 text-purple-300 font-black"
                              : "bg-slate-950 border-slate-850 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {ft === "cover" ? "Full" : "Fit"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* MC Camera Settings: Device, Resolution, Zoom */}
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-850/80 space-y-2 text-[8px] font-mono text-slate-450">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Resolution selector */}
                    <div className="space-y-1">
                      <span className="text-slate-500 block font-bold">ĐỘ PHÂN GIẢI CỦA MC</span>
                      <div className="grid grid-cols-4 gap-0.5">
                        {(["1080p", "720p", "480p", "360p"] as const).map(res => {
                          const active = hostResolution === res;
                          return (
                            <button
                              key={res}
                              type="button"
                              onClick={() => {
                                setMcCustomSettingsApplied(true);
                                setHostResolution(res);
                                updateMCStream(hostSelectedVideo, res, hostZoom);
                              }}
                              className={`py-0.5 rounded text-[7px] font-bold cursor-pointer transition-colors ${
                                active ? "bg-purple-500 text-white font-black" : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                              }`}
                            >
                              {res}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Camera Selector Dropdown */}
                    <div className="space-y-1">
                      <span className="text-slate-500 block font-bold">THIẾT BỊ CAMERA CỦA MC</span>
                      <select
                        value={hostSelectedVideo}
                        onChange={(e) => {
                          const devId = e.target.value;
                          setHostSelectedVideo(devId);
                          updateMCStream(devId, hostResolution, hostZoom);
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-slate-300 text-[8px] focus:outline-none focus:border-purple-500 cursor-pointer"
                      >
                        <option value="auto">📹 Tự động nhận diện</option>
                        {hostDevices.map((dev) => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            📹 {dev.label || "Camera"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Zoom slider */}
                  <div className="space-y-1 pt-1 border-t border-slate-900">
                    <div className="flex justify-between items-center text-slate-500">
                      <span>TĂNG/GIẢM ZOOM CAMERA MC</span>
                      <span className="text-purple-400 font-bold">{hostZoom}x</span>
                    </div>
                    <input 
                      type="range"
                      min="1.0"
                      max="4.0"
                      step="0.1"
                      value={hostZoom}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setHostZoom(val);
                        updateMCStream(hostSelectedVideo, hostResolution, val);
                      }}
                      className="w-full h-1 bg-slate-900 rounded appearance-none cursor-pointer accent-purple-400"
                    />
                  </div>
                </div>

                {/* Bandwidth selector */}
                <div className="bg-slate-950 p-1.5 rounded-lg border border-slate-850/80 flex items-center justify-between gap-1.5">
                  <span className="text-[8px] font-mono text-slate-500 uppercase tracking-wider font-bold">⚡ BĂNG THÔNG MC GỬI:</span>
                  <div className="flex gap-1">
                    {[400, 800, 1000, 2000, 4000].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setHostBitrate(rate)}
                        className={`px-1.5 py-0.5 text-[8px] font-bold font-mono rounded border cursor-pointer transition-all ${
                          hostBitrate === rate
                            ? "bg-purple-500/20 border-purple-500/80 text-purple-300"
                            : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {rate < 1000 ? `${rate}k` : `${rate / 1000}M`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Connected Athletes monitoring area - Image 4 inspired 2-slot system */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col space-y-3 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                <Radio className="h-4 w-4 text-cyan-400 animate-pulse" />
                <span>GIÁM SÁT & ĐIỀU KHIỂN VĐV TỪ XA (TỐI ĐA 2 VĐV)</span>
              </span>
              
              <div className="flex items-center gap-1.5">
                <div className="flex items-center bg-slate-950 rounded-md p-0.5 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setVisibleSlotsCount(prev => Math.max(prev - 1, 1))}
                    disabled={visibleSlotsCount <= 1}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-900 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer transition-all"
                    title="Bớt slot VĐV"
                  >
                    <Minus className="h-2.5 w-2.5" />
                  </button>
                  <span className="px-1.5 text-[9px] font-mono font-bold text-cyan-400">{visibleSlotsCount} Slot</span>
                  <button
                    type="button"
                    onClick={() => setVisibleSlotsCount(prev => Math.min(prev + 1, 2))}
                    disabled={visibleSlotsCount >= 2}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-900 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer transition-all flex items-center gap-0.5 font-bold text-[8px]"
                    title="Thêm slot VĐV"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    <span>THÊM VĐV</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
              {(() => {
                // Advanced matching algorithm to route active athletes to the correct slot index
                const slotAthletes: (ConnectedPeer | undefined)[] = [undefined, undefined];
                const assignedPeers = new Set<string>();

                // Step 0: Assign connected athletes that match the exact invite ID of each slot (slot index + 1 or invite.id)
                for (let i = 0; i < 2; i++) {
                  const invite = athleteInvites[i];
                  const expectedId = `inv_${i + 1}`;
                  const matchingAthlete = activeAthletesList.find(
                    p => (p.id === expectedId || (invite && p.id === invite.id)) && !assignedPeers.has(p.id)
                  );
                  if (matchingAthlete) {
                    slotAthletes[i] = matchingAthlete;
                    assignedPeers.add(matchingAthlete.id);
                  }
                }

                // Step 1: Assign connected athletes that match the invite name of each slot (as fallback)
                for (let i = 0; i < 2; i++) {
                  if (!slotAthletes[i]) {
                    const invite = athleteInvites[i];
                    if (invite) {
                      const matchingAthlete = activeAthletesList.find(
                        p => p.name.trim().toLowerCase() === invite.name.trim().toLowerCase() && !assignedPeers.has(p.id)
                      );
                      if (matchingAthlete) {
                        slotAthletes[i] = matchingAthlete;
                        assignedPeers.add(matchingAthlete.id);
                      }
                    }
                  }
                }

                // Step 2: Assign any remaining connected athletes to empty slots
                for (let i = 0; i < 2; i++) {
                  if (!slotAthletes[i]) {
                    const unassignedAthlete = activeAthletesList.find(p => !assignedPeers.has(p.id));
                    if (unassignedAthlete) {
                      slotAthletes[i] = unassignedAthlete;
                      assignedPeers.add(unassignedAthlete.id);
                    }
                  }
                }

                return [0, 1].slice(0, visibleSlotsCount).map((index) => {
                  const athlete = slotAthletes[index];
                  const isConnected = !!athlete;
                  const invite = athleteInvites[index];
                  const inviteName = invite ? invite.name : `Vận động viên ${index + 1}`;
                  const inviteLink = `${window.location.origin}/?role=athlete&roomId=${roomId}&athleteId=inv_${index + 1}&name=${encodeURIComponent(inviteName)}`;

                  return (
                    <div key={index} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-md">
                      {/* Slot Header */}
                      <div className="bg-slate-900/60 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-bold bg-slate-800 text-slate-300 px-1 py-0.2 rounded">
                            GUEST {index + 1}
                          </span>
                          <span className="font-bold text-white truncate max-w-[120px]">
                            {isConnected ? athlete.name : inviteName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isConnected && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[8px] font-bold ${
                              slotNetworkType[athlete.id] === "4G/5G"
                                ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                                : "bg-cyan-500/10 border border-cyan-500/20 text-cyan-400"
                            }`}>
                              {slotNetworkType[athlete.id] === "4G/5G" ? "📶 4G/5G" : "📶 WIFI"}
                            </span>
                          )}
                          <span className={`inline-flex items-center gap-0.5 px-1 rounded text-[8px] font-bold ${
                            isConnected ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-slate-900 border border-slate-800 text-slate-500"
                          }`}>
                            <span className={`h-1 w-1 rounded-full ${isConnected ? "bg-green-400 animate-ping" : "bg-slate-600"}`} />
                            {isConnected ? "ONLINE" : "WAITING"}
                          </span>
                        </div>
                      </div>

                      {/* Slot Content */}
                      {isConnected ? (
                        <div className="p-2.5 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                          
                          {/* Video monitor and basic local feedback (Optimized Status Only) */}
                          <div className="md:col-span-4 flex flex-col space-y-1.5 w-full">
                            <div className="bg-slate-950 rounded-lg overflow-hidden relative border border-white/5 shadow-inner aspect-video flex flex-col items-center justify-center p-3 select-none">
                              <div className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-600"} mb-1`} />
                              <span className={`text-[10px] font-mono font-bold ${isConnected ? "text-emerald-400" : "text-slate-500"}`}>
                                {isConnected ? "● VĐV ONLINE" : "● OFFLINE"}
                              </span>
                              <span className="text-[7px] text-slate-500 font-mono uppercase tracking-wider mt-0.5 text-center">
                                BĂNG THÔNG TỐI ƯU
                              </span>

                              {/* Hidden Audio/Video element to retain background WebRTC audio playback */}
                              {isConnected && athlete.stream && (
                                <audio
                                  autoPlay
                                  muted={slotMicMuted[athlete.id] ?? true}
                                  ref={el => {
                                    if (el) {
                                      if (el.srcObject !== athlete.stream) {
                                        el.srcObject = athlete.stream!;
                                      }
                                      const vol = slotVolume[athlete.id] ?? 85;
                                      el.volume = vol / 100;
                                      el.play().catch(() => {});
                                    }
                                  }}
                                />
                              )}
                              
                              {/* Floating overlay quality tag */}
                              <div className="absolute bottom-1 left-1 bg-black/80 px-1 py-0.2 rounded text-[8px] font-mono text-cyan-400 flex items-center gap-1">
                                <span>{slotRes[athlete.id] || "1080p"}</span>
                                {slotZoom[athlete.id] && slotZoom[athlete.id] > 1 && <span>• {slotZoom[athlete.id]}x</span>}
                              </div>

                              {/* Floating overlay status indicators */}
                              <div className="absolute top-1 right-1 flex items-center gap-1">
                                <span className={`px-1 py-0.2 rounded text-[7px] font-mono font-bold ${!(slotCamActive[athlete.id] ?? true) ? "bg-rose-600 text-white" : "bg-slate-900/80 text-emerald-400"}`}>
                                  {!(slotCamActive[athlete.id] ?? true) ? "CAM: OFF" : "CAM: ON"}
                                </span>
                                <span className={`px-1 py-0.2 rounded text-[7px] font-mono font-bold ${slotMicMuted[athlete.id] ? "bg-rose-600 text-white" : "bg-slate-900/80 text-emerald-400"}`}>
                                  {slotMicMuted[athlete.id] ? "MIC: OFF" : "MIC: ON"}
                                </span>
                                <span className={`px-1 py-0.2 rounded text-[7px] font-mono font-bold ${slotSpeakerMuted[athlete.id] ? "bg-rose-600 text-white" : "bg-slate-900/80 text-emerald-400"}`}>
                                  {slotSpeakerMuted[athlete.id] ? "SPK: OFF" : "SPK: ON"}
                                </span>
                              </div>
                            </div>

                            {/* Sound feedback slider */}
                            <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-1 rounded border border-slate-800/80">
                              <button 
                                onClick={() => {
                                  const currentMuted = slotMicMuted[athlete.id] || false;
                                  const nextMuted = !currentMuted;
                                  setSlotMicMuted(prev => ({ ...prev, [athlete.id]: nextMuted }));
                                  sendRemoteControl(athlete.id, "toggle-mic", !nextMuted);
                                }}
                                className={`p-0.5 rounded cursor-pointer ${slotMicMuted[athlete.id] ? "text-rose-500" : "text-slate-400 hover:text-white"}`}
                              >
                                {slotMicMuted[athlete.id] ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                              </button>
                              <input 
                                type="range"
                                min="0"
                                max="100"
                                value={slotVolume[athlete.id] ?? 85}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  setSlotVolume(prev => ({ ...prev, [athlete.id]: val }));
                                }}
                                className="flex-1 h-0.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                              />
                              <span className="text-[8px] font-mono text-slate-500">{(slotVolume[athlete.id] ?? 85)}%</span>
                            </div>
                          </div>

                          {/* Image 4 Buttons matrix */}
                          <div className="md:col-span-8 flex flex-col space-y-1.5 min-w-0 w-full">
                            <div className="grid grid-cols-2 gap-1 text-[8px] font-mono">
                              
                              {/* Toggle Remote Buttons */}
                              <button 
                                onClick={() => {
                                  const currentMuted = slotMicMuted[athlete.id] || false;
                                  const nextMuted = !currentMuted;
                                  setSlotMicMuted(prev => ({ ...prev, [athlete.id]: nextMuted }));
                                  sendRemoteControl(athlete.id, "toggle-mic", !nextMuted);
                                }}
                                className={`py-0.5 px-1 rounded font-bold border transition-all cursor-pointer text-center ${
                                  slotMicMuted[athlete.id] ? "bg-rose-500/20 border-rose-500/30 text-rose-400" : "bg-slate-900 border-slate-800 text-slate-300"
                                }`}
                              >
                                {slotMicMuted[athlete.id] ? "🎙️ MỞ MIC" : "🎙️ TẮT MIC"}
                              </button>

                              <button 
                                onClick={() => {
                                  const currentCamActive = slotCamActive[athlete.id] ?? true;
                                  const nextCamActive = !currentCamActive;
                                  setSlotCamActive(prev => ({ ...prev, [athlete.id]: nextCamActive }));
                                  sendRemoteControl(athlete.id, "toggle-cam", nextCamActive);
                                }}
                                className={`py-0.5 px-1 rounded font-bold border transition-all cursor-pointer text-center ${
                                  !(slotCamActive[athlete.id] ?? true) ? "bg-rose-500/20 border-rose-500/30 text-rose-400" : "bg-slate-900 border-slate-800 text-slate-300"
                                }`}
                              >
                                {!(slotCamActive[athlete.id] ?? true) ? "📹 BẬT CAM" : "📹 TẮT CAM"}
                              </button>

                              <button 
                                onClick={() => {
                                  const currentSpeakerMuted = slotSpeakerMuted[athlete.id] || false;
                                  const nextSpeakerMuted = !currentSpeakerMuted;
                                  setSlotSpeakerMuted(prev => ({ ...prev, [athlete.id]: nextSpeakerMuted }));
                                  sendRemoteControl(athlete.id, "toggle-speaker", !nextSpeakerMuted);
                                }}
                                className={`py-0.5 px-1 rounded font-bold border transition-all cursor-pointer text-center ${
                                  slotSpeakerMuted[athlete.id] ? "bg-rose-500/20 border-rose-500/30 text-rose-400" : "bg-slate-900 border-slate-800 text-slate-300"
                                }`}
                              >
                                {slotSpeakerMuted[athlete.id] ? "🎧 BẬT LOA" : "🎧 TẮT LOA"}
                              </button>

                              <button 
                                onClick={() => {
                                  console.log(`[Host Dashboard] Manually reconnecting athlete ${athlete.id}`);
                                  handleCreateOfferToAthlete(athlete.id);
                                }}
                                className="py-0.5 px-1 rounded font-bold border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 transition-all cursor-pointer text-center"
                                title="Làm mới luồng WebRTC thủ công"
                              >
                                🔄 RECONNECT
                              </button>

                            </div>

                            {/* CẤU HÌNH ĐỒ HỌA & HIỂN THỊ (Lớp đè, Ẩn/Hiện, Kick) */}
                            <div className="bg-slate-900 p-1.5 rounded border border-slate-800/80 space-y-1">
                              <span className="block text-[7px] font-mono text-slate-500 font-bold uppercase tracking-wider">CẤU HÌNH ĐỒ HỌA & HIỂN THỊ</span>
                              <div className="grid grid-cols-4 gap-1">
                                {/* Ẩn/Hiện */}
                                <button
                                  onClick={() => togglePeerVisibility(athlete.id)}
                                  className={`py-1 rounded font-mono font-bold border transition-all cursor-pointer text-[7px] flex flex-col items-center justify-center ${
                                    settings.hiddenPeers?.[athlete.id]
                                      ? "bg-rose-500/15 border-rose-500/30 text-rose-400 font-black"
                                      : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 font-black"
                                  }`}
                                  title="Ẩn hoặc Hiện VĐV này trên Tổng Output"
                                >
                                  {settings.hiddenPeers?.[athlete.id] ? "👁️ ĐÃ ẨN" : "👁️ HIỆN DIỆN"}
                                </button>

                                {/* PIP Toggle */}
                                <button
                                  onClick={() => togglePipPeer(athlete.id)}
                                  className={`py-1 rounded font-mono font-bold border transition-all cursor-pointer text-[7px] flex flex-col items-center justify-center ${
                                    settings.pipPeers?.[athlete.id]
                                      ? "bg-cyan-500 border-cyan-500 text-black font-black"
                                      : "bg-slate-950 border-slate-850 text-slate-400 hover:text-white"
                                  }`}
                                  title="Chuyển VĐV thành khung tròn PIP"
                                >
                                  {settings.pipPeers?.[athlete.id] ? "⭕ PIP: ON" : "⭕ PIP: OFF"}
                                </button>

                                {/* Lên / Xuống layer */}
                                <div className="flex bg-slate-950 border border-slate-850 rounded overflow-hidden">
                                  <button
                                    onClick={() => movePeerOrder(athlete.id, "down")}
                                    className="flex-1 py-1 text-center hover:bg-slate-800 text-[8px] text-slate-400 hover:text-white border-r border-slate-850 font-black cursor-pointer"
                                    title="Hạ thấp lớp xếp chồng (Bị che bên dưới)"
                                  >
                                    ▼ DƯỚI
                                  </button>
                                  <button
                                    onClick={() => movePeerOrder(athlete.id, "up")}
                                    className="flex-1 py-1 text-center hover:bg-slate-800 text-[8px] text-slate-400 hover:text-white font-black cursor-pointer"
                                    title="Nâng cao lớp xếp chồng (Đè lên trên)"
                                  >
                                    ▲ TRÊN
                                  </button>
                                </div>

                                {/* Kick/Xóa */}
                                <button
                                  onClick={() => {
                                    if (confirm(`Bạn có chắc chắn muốn xóa VĐV ${athlete.name} ra khỏi phòng?`)) {
                                      sendRemoteControl(athlete.id, "kick", true);
                                    }
                                  }}
                                  className="py-1 rounded font-mono font-bold border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-all cursor-pointer text-[7px] flex items-center justify-center gap-0.5"
                                  title="Xóa VĐV này khỏi phòng thi đấu"
                                >
                                  <span>➖ XÓA</span>
                                </button>
                              </div>
                            </div>

                            {/* Control row indicators (Image 4 exact simulation) */}
                            <div className="space-y-1 bg-slate-900 p-1.5 rounded border border-slate-800/60 text-[8px] font-mono">
                              {/* Row 1: Record / Mute in scene */}
                              <div className="grid grid-cols-2 gap-1">
                                <button className="bg-slate-950 border border-slate-800 py-0.5 rounded text-rose-500 font-bold">● RECORD</button>
                                <button className="bg-slate-950 border border-slate-800 py-0.5 rounded text-slate-400">MUTE IN SCENE</button>
                              </div>

                              {/* Row 2: Highlight */}
                              <div className="grid grid-cols-2 gap-1">
                                <button 
                                  onClick={() => updateSettingField("highlightedClientId", settings.highlightedClientId === athlete.id ? "" : athlete.id)}
                                  className={`py-0.5 rounded border font-bold ${settings.highlightedClientId === athlete.id ? "bg-yellow-500/20 border-yellow-500/30 text-yellow-400" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                                >
                                  {settings.highlightedClientId === athlete.id ? "★ HIGHLIGHTED" : "★ HIGHLIGHT"}
                                </button>
                                <button className="bg-slate-950 border border-slate-800 py-0.5 rounded text-cyan-400">ADD TO SCENE 1</button>
                              </div>

                              {/* Row 3: Scenes selection buttons */}
                              <div className="flex items-center gap-0.5 py-0.5">
                                <span className="text-slate-500 font-bold scale-90">SCENE:</span>
                                {["s2", "s3", "s4", "s5", "s6", "s7"].map(sc => {
                                  const active = slotSelectedScene[athlete.id] === sc;
                                  return (
                                    <button 
                                      key={sc}
                                      onClick={() => setSlotSelectedScene(prev => ({ ...prev, [athlete.id]: sc }))}
                                      className={`px-1 py-0.2 rounded border text-[7px] font-bold cursor-pointer transition-colors ${
                                        active ? "bg-cyan-500 text-black border-cyan-500" : "bg-slate-950 border-slate-850 text-slate-400 hover:text-white"
                                      }`}
                                    >
                                      {sc}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Row 4: Camera mix selection buttons */}
                              <div className="flex items-center gap-0.5 py-0.5">
                                <span className="text-slate-500 font-bold scale-90">CAM:</span>
                                {["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map(cm => {
                                  const active = slotSelectedCamMix[athlete.id] === cm;
                                  return (
                                    <button 
                                      key={cm}
                                      onClick={() => setSlotSelectedCamMix(prev => ({ ...prev, [athlete.id]: cm }))}
                                      className={`px-1 py-0.2 rounded border text-[7px] font-bold cursor-pointer transition-colors ${
                                        active ? "bg-purple-500 text-white border-purple-500" : "bg-slate-950 border-slate-850 text-slate-400 hover:text-white"
                                      }`}
                                    >
                                      {cm}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Row 5: Gain selector */}
                              <div className="flex items-center gap-0.5 py-0.5">
                                <span className="text-slate-500 font-bold scale-90">GAIN:</span>
                                {["g1", "g2", "g3", "g4", "g5", "g6"].map(gn => {
                                  const active = slotSelectedGain[athlete.id] === gn;
                                  return (
                                    <button 
                                      key={gn}
                                      onClick={() => setSlotSelectedGain(prev => ({ ...prev, [athlete.id]: gn }))}
                                      className={`px-1 py-0.2 rounded border text-[7px] font-bold cursor-pointer transition-colors ${
                                        active ? "bg-amber-500 text-black border-amber-500" : "bg-slate-950 border-slate-850 text-slate-400 hover:text-white"
                                      }`}
                                    >
                                      {gn}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Row 6: Mix order modifier */}
                              <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-800">
                                <button 
                                  onClick={() => {
                                    const currentVal = slotMixOrder[athlete.id] ?? 0;
                                    setSlotMixOrder(prev => ({ ...prev, [athlete.id]: currentVal - 1 }));
                                  }}
                                  className="bg-slate-950 border border-slate-800 px-1 py-0.2 rounded text-slate-400 hover:text-white text-[7px]"
                                >
                                  -
                                </button>
                                <span className="text-[7px] font-bold font-mono text-slate-500 uppercase">
                                  {slotMixOrder[athlete.id] ?? 0} MIX ORDER
                                </span>
                                <button 
                                  onClick={() => {
                                    const currentVal = slotMixOrder[athlete.id] ?? 0;
                                    setSlotMixOrder(prev => ({ ...prev, [athlete.id]: currentVal + 1 }));
                                  }}
                                  className="bg-slate-950 border border-slate-800 px-1 py-0.2 rounded text-slate-400 hover:text-white text-[7px]"
                                >
                                  +
                                </button>
                              </div>

                            </div>

                            {/* Quick remote settings collapsible panel */}
                            <div className="pt-1.5 border-t border-slate-900 flex flex-col space-y-1.5">
                              <div className="flex items-center justify-between">
                                <button
                                  onClick={() => setOpenSlotSettings(prev => ({ ...prev, [index]: !prev[index] }))}
                                  className="text-[8px] font-mono font-black text-cyan-400 flex items-center gap-1 bg-cyan-950/40 hover:bg-cyan-950/70 border border-cyan-800/30 px-1.5 py-0.5 rounded cursor-pointer transition-all"
                                >
                                  <Settings className="h-2.5 w-2.5" />
                                  <span>{openSlotSettings[index] ? "ĐÓNG THIẾT LẬP TỪ XA" : "ĐIỀU KHIỂN CHẤT LƯỢNG & ZOOM TỪ XA"}</span>
                                </button>
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={() => {
                                      const link = `${window.location.origin}/?role=athlete&roomId=${roomId}&athleteId=${athlete.id}&name=${encodeURIComponent(athlete.name)}`;
                                      navigator.clipboard.writeText(link);
                                      alert("Đã copy solo live stream link của VĐV!");
                                    }}
                                    className="text-[8px] text-slate-500 hover:text-slate-300 font-mono transition-colors cursor-pointer"
                                    title="Copy link để VĐV truy cập và phát hình"
                                  >
                                    Copy Live Link
                                  </button>
                                  <span className="text-slate-700 text-[8px] select-none">|</span>
                                  <button 
                                    onClick={() => copySoloObsLinkToClipboard(athlete.id)}
                                    className={`text-[8px] font-bold font-mono transition-all cursor-pointer ${
                                      copiedSoloObsId === athlete.id ? "text-emerald-400 font-extrabold" : "text-purple-400 hover:text-purple-300"
                                    }`}
                                    title="Copy link trình duyệt VSC SOLO của VĐV này (gồm video + tên + điểm)"
                                  >
                                    {copiedSoloObsId === athlete.id ? "✓ COPIED VSC" : "COPY SOLO VSC"}
                                  </button>
                                </div>
                              </div>

                              {openSlotSettings[index] && (
                                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 space-y-2 text-[8px] font-mono">
                                  {/* Resolution selector */}
                                  <div className="space-y-1">
                                    <span className="text-slate-400 block font-bold">CHỌN ĐỘ PHÂN GIẢI CỦA VĐV</span>
                                    <div className="grid grid-cols-3 gap-1">
                                      {(["1080p", "720p", "480p"] as const).map(res => {
                                        const active = (slotRes[athlete.id] || "1080p") === res;
                                        return (
                                          <button
                                            key={res}
                                            onClick={() => {
                                              setSlotRes(prev => ({ ...prev, [athlete.id]: res }));
                                              sendRemoteControl(athlete.id, "change-res", res);
                                            }}
                                            className={`py-0.5 rounded text-[8px] font-bold cursor-pointer transition-colors ${
                                              active ? "bg-cyan-500 text-black font-black" : "bg-slate-950 border border-slate-850 text-slate-400 hover:text-white"
                                            }`}
                                          >
                                            {res}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Camera Selector Dropdown */}
                                  <div className="space-y-1 pt-1 border-t border-slate-950/60">
                                    <span className="text-slate-400 block font-bold">CHỌN THIẾT BỊ CAMERA CỦA VĐV</span>
                                    <select
                                      value={slotSelectedVideo[athlete.id] || "auto"}
                                      onChange={(e) => {
                                        const devId = e.target.value;
                                        setSlotSelectedVideo(prev => ({ ...prev, [athlete.id]: devId }));
                                        sendRemoteControl(athlete.id, "change-camera", devId);
                                      }}
                                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 text-[8px] focus:outline-none focus:border-cyan-500 cursor-pointer"
                                    >
                                      <option value="auto">📹 Tự động nhận diện (Mặc định)</option>
                                      {athleteDevices[athlete.id]?.map((dev) => (
                                        <option key={dev.deviceId} value={dev.deviceId}>
                                          📹 {dev.label || "Camera"}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Zoom slider */}
                                  <div className="space-y-1">
                                    <div className="flex justify-between items-center text-slate-400">
                                      <span>TĂNG/GIẢM ZOOM CAMERA TỪ XA</span>
                                      <span className="text-cyan-400 font-bold">{slotZoom[athlete.id] ?? 1.0}x</span>
                                    </div>
                                    <input 
                                      type="range"
                                      min="1.0"
                                      max="4.0"
                                      step="0.1"
                                      value={slotZoom[athlete.id] ?? 1.0}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setSlotZoom(prev => ({ ...prev, [athlete.id]: val }));
                                        sendRemoteControl(athlete.id, "set-zoom", val);
                                      }}
                                      className="w-full h-1 bg-slate-950 rounded appearance-none cursor-pointer accent-cyan-400"
                                    />
                                  </div>

                                  {/* Network Bandwidth Allocator (Bitrate selector) */}
                                  <div className="space-y-1 pt-1.5 border-t border-slate-950">
                                    <span className="text-slate-400 block font-bold">PHÂN LUỒNG TỐC ĐỘ MẠNG (BITRATE)</span>
                                    <div className="grid grid-cols-4 gap-1">
                                      {([1000, 2000, 4000, 6000] as const).map(rate => {
                                        const active = (athleteBitrates[athlete.id] || 2000) === rate;
                                        return (
                                          <button
                                            key={rate}
                                            type="button"
                                            onClick={() => {
                                              setAthleteBitrates(prev => ({ ...prev, [athlete.id]: rate }));
                                              sendRemoteControl(athlete.id, "set-bitrate", rate);
                                            }}
                                            className={`py-0.5 rounded text-[8px] font-bold cursor-pointer transition-colors ${
                                              active ? "bg-cyan-500 text-black font-black" : "bg-slate-950 border border-slate-850 text-slate-400 hover:text-white"
                                            }`}
                                          >
                                            {rate === 1000 ? "1000k (Min)" : `${rate / 1000}M`}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <span className="text-[7px] text-slate-500 block leading-tight">
                                      Giới hạn băng thông gửi đi của VĐV để ưu tiên tốc độ, tránh lag.
                                    </span>
                                  </div>

                                  {/* Cấu hình Camera của VĐV */}
                                  <div className="space-y-1.5 pt-2 border-t border-slate-950">
                                    <span className="text-slate-400 block font-bold">CẤU HÌNH CAMERA VĐV</span>
                                    
                                    <div className="grid grid-cols-3 gap-1.5 mt-1">
                                      {/* Tỉ lệ */}
                                      <div className="space-y-0.5">
                                        <span className="text-slate-500 block text-[7px] font-bold uppercase">TỈ LỆ</span>
                                        <div className="flex gap-0.5">
                                          {(["16:9", "9:16"] as const).map(asp => (
                                            <button
                                              key={asp}
                                              type="button"
                                              onClick={() => updateCameraTransform(athlete.id, "aspect", asp)}
                                              className={`py-0.5 rounded text-[7px] font-bold cursor-pointer flex-1 text-center transition-colors ${
                                                (settings.cameraAspects?.[athlete.id] ?? "16:9") === asp
                                                  ? "bg-cyan-500 text-black font-black"
                                                  : "bg-slate-950 border border-slate-850 text-slate-400 hover:text-white"
                                              }`}
                                            >
                                              {asp}
                                            </button>
                                          ))}
                                        </div>
                                      </div>

                                      {/* Xoay */}
                                      <div className="space-y-0.5">
                                        <span className="text-slate-500 block text-[7px] font-bold uppercase">XOAY</span>
                                        <div className="flex gap-0.5 overflow-x-auto">
                                          {([0, 90, 180, 270] as const).map(deg => (
                                            <button
                                              key={deg}
                                              type="button"
                                              onClick={() => updateCameraTransform(athlete.id, "rotation", deg)}
                                              className={`py-0.5 rounded text-[7px] font-bold cursor-pointer flex-1 text-center transition-colors ${
                                                (settings.cameraRotations?.[athlete.id] ?? 0) === deg
                                                  ? "bg-cyan-500 text-black font-black"
                                                  : "bg-slate-950 border border-slate-850 text-slate-400 hover:text-white"
                                              }`}
                                            >
                                              {deg}°
                                            </button>
                                          ))}
                                        </div>
                                      </div>

                                      {/* Dạng fit */}
                                      <div className="space-y-0.5">
                                        <span className="text-slate-500 block text-[7px] font-bold uppercase">HIỂN THỊ</span>
                                        <div className="flex gap-0.5">
                                          {(["cover", "contain"] as const).map(ft => (
                                            <button
                                              key={ft}
                                              type="button"
                                              onClick={() => updateCameraTransform(athlete.id, "fit", ft)}
                                              className={`py-0.5 rounded text-[7px] font-bold cursor-pointer flex-1 text-center transition-colors ${
                                                (settings.cameraFits?.[athlete.id] ?? "cover") === ft
                                                  ? "bg-cyan-500 text-black font-black"
                                                  : "bg-slate-950 border border-slate-850 text-slate-400 hover:text-white"
                                              }`}
                                            >
                                              {ft === "cover" ? "Full" : "Fit"}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                          </div>
                        </div>
                      ) : (
                        /* Disconnected Waiting State with Link & Inline edit name input */
                        <div className="p-4 flex flex-col items-center justify-center text-center space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center text-slate-500 font-mono font-bold text-[10px]">
                              {index + 1}
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 font-mono">GUEST SLOT {index + 1}</span>
                          </div>
                          
                          {/* Inline name editor */}
                          <div className="w-full max-w-[220px] space-y-1">
                            <label className="text-[8px] text-slate-500 font-mono uppercase block text-left">Tên Vận động viên:</label>
                            <input 
                              type="text"
                              value={inviteName}
                              onChange={(e) => {
                                const updatedName = e.target.value;
                                setAthleteInvites(prev => {
                                  const next = [...prev];
                                  next[index] = { id: `inv_${index + 1}`, name: updatedName };
                                  return next;
                                });
                              }}
                              className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500/50 rounded px-2.5 py-1 text-[10px] text-white text-center font-sans outline-none font-semibold"
                              placeholder="Nhập tên VĐV..."
                            />
                          </div>

                          <div className="flex gap-2 w-full justify-center">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(inviteLink);
                                alert(`Đã copy link mời riêng cho VĐV: ${inviteName}!`);
                              }}
                              className="bg-slate-900 hover:bg-slate-850 hover:text-white border border-slate-800 hover:border-slate-700 text-slate-300 text-[10px] font-bold font-mono px-3 py-1.5 rounded flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <Link className="h-3 w-3 text-cyan-400" />
                              <span>Sao chép Link mời riêng</span>
                            </button>

                            <button
                              onClick={() => {
                                if (confirm(`Bạn có chắc chắn muốn xóa GUEST SLOT ${index + 1} (${inviteName})?`)) {
                                  handleDeleteAthleteSlot(index);
                                }
                              }}
                              className="bg-rose-950/30 hover:bg-rose-950/60 border border-rose-900/80 hover:border-rose-800 text-rose-400 text-[10px] font-bold font-mono px-3 py-1.5 rounded flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <span>➖ Xóa SLOT</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

        </div>

        {/* Right Side (MC Broadcast control board): col-span-7 */}
        <div className="xl:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-6 shadow-xl">
          
          <div className="space-y-6 overflow-y-auto max-h-[750px] pr-2">
            
            {/* Header section with VFX Trigger */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between border-b border-slate-800 pb-4 gap-4">
              <div>
                <h3 className="text-sm font-bold font-mono text-white flex items-center gap-1.5">
                  <Settings className="h-4.5 w-4.5 text-purple-400" />
                  <span>BÀN ĐIỀU PHỐI ĐỒ HỌA LIVESTREAM (REMOTE CONTROL)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">Các chỉnh sửa tại đây sẽ đồng bộ tức thì lên OBS Browser Source.</p>
              </div>

              <div className="flex items-center gap-2 w-full lg:w-auto">
                {/* Toggle Graphics Settings */}
                <button
                  onClick={() => setShowGraphicsSettings(!showGraphicsSettings)}
                  className={`flex-1 lg:flex-initial px-3 py-2 rounded-lg text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all border ${
                    showGraphicsSettings
                      ? "bg-slate-850 border-slate-700 hover:bg-slate-800 text-slate-200"
                      : "bg-purple-600 border-purple-500 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                  }`}
                >
                  {showGraphicsSettings ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  <span>{showGraphicsSettings ? "ẨN CÀI ĐẶT" : "HIỆN CÀI ĐẶT"}</span>
                </button>

                {/* VFX Confetti trigger button */}
                <button 
                  onClick={triggerConfettiVFX}
                  className="flex-1 lg:flex-initial bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 active:scale-95 text-slate-950 font-black px-4 py-2 rounded-lg text-xs font-mono flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-amber-500/20"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>BẮN PHÁO HOA 🎉</span>
                </button>
              </div>
            </div>

            {showGraphicsSettings ? (
              <>

            {/* 1. Layout Control Selection Grid */}
            <div className="space-y-2 bg-slate-900/40 border border-slate-800 p-4 rounded-xl shadow-md">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-400 font-mono uppercase tracking-widest font-bold block">1. CHỌN BỐ CỤC ĐỒ HỌA (LAYOUT)</label>
              </div>
              
              <div className="relative">
                <select
                  value={settings.layout || "custom"}
                  onChange={(e) => updateSettingField("layout", e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono font-bold py-2.5 px-3.5 rounded-xl outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all cursor-pointer appearance-none uppercase"
                >
                  <option value="custom">🎨 BỐ CỤC TỰ DO (CUSTOM & KÉO THẢ)</option>
                  <option value="grid">BENTO GRID (CHIA ĐỀU TỈ LỆ)</option>
                  <option value="split">SPLIT SCREEN (CHIA ĐÔI MÀN HÌNH)</option>
                  <option value="pip-host">PIP (VĐV NỔI BẬT - HOST GÓC TRÒN)</option>
                  <option value="pip-athlete">PIP (MC NỔI BẬT - VĐV GÓC TRÒN)</option>
                  <option value="side-by-side">GÓC CẬN (MẶT ĐỐI MẶT RỘNG)</option>
                  <option value="single">CẬN CẢNH (SINGLE - 1 KHUNG HÌNH)</option>
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400 text-[10px]">
                  ▼
                </div>
              </div>

              <div className="text-[10px] text-slate-400 font-medium font-sans flex items-center gap-1.5 px-1 bg-slate-950/50 p-2 rounded-lg border border-white/5">
                <span className="text-purple-400 font-bold">💡</span>
                <span>
                  {settings.layout === "custom" && "BỐ CỤC TỰ DO: Kéo thả, thay đổi kích thước, cắt xén (Crop) cực linh hoạt."}
                  {settings.layout === "grid" && "BENTO GRID: Chia đều tỉ lệ các luồng phát sóng tự động."}
                  {settings.layout === "split" && "SPLIT SCREEN: Chia đôi màn hình hiển thị trực tiếp cân xứng."}
                  {settings.layout === "pip-host" && "PIP VĐV: Hình ảnh MC/Host được đặt nhỏ gọn trong góc tròn nổi phía trên."}
                  {settings.layout === "pip-athlete" && "PIP MC: Hình ảnh VĐV được đặt nhỏ gọn trong góc tròn nổi phía trên."}
                  {settings.layout === "side-by-side" && "GÓC CẬN: Bố cục trò chuyện cận mặt đối mặt rộng."}
                  {settings.layout === "single" && "CẬN CẢNH: Chỉ hiển thị một khung hình phát sóng của khách mời/chủ phòng chính."}
                </span>
              </div>
            </div>

            {/* Aspect Ratio Toggle (16:9 vs 9:16) */}
            <div className="space-y-2 bg-slate-900/40 border border-slate-800 p-4 rounded-xl shadow-md">
              <label className="text-[10px] text-slate-400 font-mono uppercase tracking-widest font-bold block">
                KHUNG HÌNH PHÁT SÓNG (ASPECT RATIO SETTINGS)
              </label>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => updateSettingField("aspectRatio", "16:9")}
                  className={`py-2.5 px-4 rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-2.5 font-bold ${
                    settings.aspectRatio === "16:9" || !settings.aspectRatio
                      ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-cyan-500 text-cyan-400 shadow-lg shadow-cyan-500/10"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <span className="text-sm">📺</span>
                  <div className="text-left leading-tight">
                    <span className="block text-xs uppercase tracking-wider font-mono">NGANG CHUẨN (16:9)</span>
                    <span className="text-[9px] text-slate-500 font-medium">YouTube, Facebook Stream</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => updateSettingField("aspectRatio", "9:16")}
                  className={`py-2.5 px-4 rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-2.5 font-bold ${
                    settings.aspectRatio === "9:16"
                      ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-purple-500 text-purple-400 shadow-lg shadow-purple-500/10"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <span className="text-sm">📱</span>
                  <div className="text-left leading-tight">
                    <span className="block text-xs uppercase tracking-wider font-mono">DỌC TIKTOK (9:16)</span>
                    <span className="text-[9px] text-slate-500 font-medium">TikTok Live, Shorts, Reels</span>
                  </div>
                </button>
              </div>
            </div>

            {/* 2. Headline Overlay / Banner Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Banner Text Control */}
              <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-300 font-mono uppercase tracking-wider font-bold">2. BANNER TIÊU ĐỀ ĐỈNH</span>
                  <input 
                    type="checkbox" 
                    checked={settings.showBanner} 
                    onChange={(e) => updateSettingField("showBanner", e.target.checked)}
                    className="cursor-pointer accent-purple-500"
                  />
                </div>
                <div className="space-y-2 pt-1">
                  <input
                    type="text"
                    value={settings.bannerText}
                    onChange={(e) => updateSettingField("bannerText", e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white outline-none"
                    placeholder="TIÊU ĐỀ HIỂN THỊ"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] text-slate-500 font-mono">MÀU NỀN</label>
                      <input 
                        type="color" 
                        value={settings.bannerBgColor} 
                        onChange={(e) => updateSettingField("bannerBgColor", e.target.value)}
                        className="w-full h-8 bg-transparent border border-slate-800 rounded cursor-pointer p-0"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 font-mono">MÀU CHỮ</label>
                      <input 
                        type="color" 
                        value={settings.bannerTextColor} 
                        onChange={(e) => updateSettingField("bannerTextColor", e.target.value)}
                        className="w-full h-8 bg-transparent border border-slate-800 rounded cursor-pointer p-0"
                      />
                    </div>
                  </div>
                  <div className="pt-1">
                    <label className="text-[8px] text-slate-500 font-mono flex justify-between">
                      <span>ĐỘ MỜ NỀN (OPACITY)</span>
                      <span>{settings.bannerBgOpacity ?? 100}%</span>
                    </label>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={settings.bannerBgOpacity ?? 100}
                      onChange={(e) => updateSettingField("bannerBgOpacity", parseInt(e.target.value, 10))}
                      className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Scrolling Ticker Text Control */}
              <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-300 font-mono uppercase tracking-wider font-bold">3. CHỮ CHẠY CHÂN TRANG (TICKER)</span>
                  <input 
                    type="checkbox" 
                    checked={settings.showTicker} 
                    onChange={(e) => updateSettingField("showTicker", e.target.checked)}
                    className="cursor-pointer accent-purple-500"
                  />
                </div>
                <div className="space-y-2 pt-1">
                  <textarea
                    value={settings.tickerText}
                    onChange={(e) => updateSettingField("tickerText", e.target.value)}
                    rows={2}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white outline-none resize-none"
                    placeholder="Nội dung thông tin chạy ngang..."
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] text-slate-500 font-mono">THỜI GIAN LẶP LẠI (GIÂY):</span>
                    <input 
                      type="number" 
                      value={settings.tickerSpeed} 
                      min={5}
                      max={60}
                      onChange={(e) => updateSettingField("tickerSpeed", parseInt(e.target.value, 10) || 15)}
                      className="w-16 bg-slate-900 border border-slate-800 text-xs text-center rounded py-0.5 text-white outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-[8px] text-slate-500 font-mono">MÀU NỀN TICKER</label>
                      <input 
                        type="color" 
                        value={settings.tickerBgColor || "#020617"} 
                        onChange={(e) => updateSettingField("tickerBgColor", e.target.value)}
                        className="w-full h-8 bg-transparent border border-slate-800 rounded cursor-pointer p-0"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] text-slate-500 font-mono flex justify-between">
                        <span>ĐỘ MỜ (OPACITY)</span>
                        <span>{settings.tickerBgOpacity ?? 90}%</span>
                      </label>
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={settings.tickerBgOpacity ?? 90}
                        onChange={(e) => updateSettingField("tickerBgOpacity", parseInt(e.target.value, 10))}
                        className="w-full h-1 mt-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* 4. Background styling and Lower Third Text */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Lower Thirds Editor */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-300 font-mono uppercase tracking-wider font-bold">5. KHUNG CHỮ HIỂN THỊ TRÁI (LOWER THIRD)</span>
                  <input 
                    type="checkbox" 
                    checked={settings.showLowerThirds} 
                    onChange={(e) => updateSettingField("showLowerThirds", e.target.checked)}
                    className="cursor-pointer accent-purple-500"
                  />
                </div>
                <input
                  type="text"
                  value={settings.lowerThirdText}
                  onChange={(e) => updateSettingField("lowerThirdText", e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white outline-none mt-1"
                  placeholder="Mô tả sự kiện / Tên VĐV đang thi đấu..."
                />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[8px] text-slate-500 font-mono">MÀU CHỦ ĐẠO L.T.</label>
                    <input 
                      type="color" 
                      value={settings.lowerThirdBgColor || "#059669"} 
                      onChange={(e) => updateSettingField("lowerThirdBgColor", e.target.value)}
                      className="w-full h-8 bg-transparent border border-slate-800 rounded cursor-pointer p-0"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] text-slate-500 font-mono flex justify-between">
                      <span>ĐỘ MỜ (OPACITY)</span>
                      <span>{settings.lowerThirdBgOpacity ?? 100}%</span>
                    </label>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={settings.lowerThirdBgOpacity ?? 100}
                      onChange={(e) => updateSettingField("lowerThirdBgOpacity", parseInt(e.target.value, 10))}
                      className="w-full h-1 mt-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* VSC Background Styles */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="text-[10px] text-slate-300 font-mono uppercase tracking-wider font-bold block">6. PHÔNG NỀN VSC CHROMAKEY</span>
                <select
                  value={settings.backgroundStyle}
                  onChange={(e) => updateSettingField("backgroundStyle", e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white outline-none cursor-pointer mt-1"
                >
                  <option value="transparent">Nền Trong Suốt (Alpha - KHUYÊN DÙNG TRONG VSC)</option>
                  <option value="dark-slate">Nền Xám Đá (Slate)</option>
                  <option value="neon-cyber">Nền Đồ Họa Neon Vũ Trụ</option>
                  <option value="soft-gradient">Nền Gradient Hòa Trộn Mềm</option>
                </select>
              </div>

             </div>

            {/* Logo Settings */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <span className="text-[10px] text-slate-300 font-mono uppercase tracking-wider font-bold block">7. LOGO THƯƠNG HIỆU / BRAND LOGO</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2 flex gap-2">
                  <input
                    type="text"
                    value={settings.logoUrl}
                    onChange={(e) => updateSettingField("logoUrl", e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white outline-none"
                    placeholder="URL của logo hoặc tải tệp lên..."
                  />
                  <label className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold px-3 py-1.5 rounded text-xs cursor-pointer flex items-center justify-center shrink-0 transition-colors">
                    <span>UPLOAD LOGO</span>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            if (typeof reader.result === "string") {
                              updateSettingField("logoUrl", reader.result);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {settings.logoUrl && (
                    <button
                      onClick={() => updateSettingField("logoUrl", "")}
                      className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-1.5 rounded text-xs cursor-pointer transition-colors"
                    >
                      XÓA
                    </button>
                  )}
                </div>
                <select
                  value={settings.logoPosition}
                  onChange={(e) => updateSettingField("logoPosition", e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white outline-none cursor-pointer"
                >
                  <option value="top-right">Góc Trên Phải</option>
                  <option value="top-left">Góc Trên Trái</option>
                  <option value="bottom-right">Góc Dưới Phải</option>
                  <option value="bottom-left">Góc Dưới Trái</option>
                </select>
              </div>
            </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 border border-dashed border-slate-800 rounded-xl bg-slate-950/30 text-center space-y-3 my-6">
                <Settings className="h-10 w-10 text-slate-600 animate-spin" style={{ animationDuration: '6s' }} />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-400">Đã ẩn Bảng Cài đặt Đồ họa</p>
                  <p className="text-xs text-slate-500 max-w-md">Cài đặt đồ họa vẫn đang hoạt động trên OBS. Bấm nút "HIỆN CÀI ĐẶT" ở góc trên để tiếp tục điều khiển.</p>
                </div>
              </div>
            )}

          </div>

          {/* Quick Exit controls */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500 font-mono">
            <span>Sản xuất bởi VSC Multi-Ingest Engine</span>
            <button
              onClick={onLeave}
              className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 font-bold bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded cursor-pointer transition-all active:scale-95"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>ĐÓNG PHÒNG STUDIO</span>
            </button>
          </div>

        </div>

      </main>
    </div>
  );
}

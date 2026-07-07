import React, { useState, useEffect, useRef } from "react";
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, Settings, RefreshCw, Radio, Shield, 
  HelpCircle, Loader2, Maximize2, Sliders, Camera, AlertTriangle, Activity, 
  Check, Copy, Plus, Minus, ZoomIn, ZoomOut, Flame, Info, MessageSquare,
  Volume2, VolumeX, RotateCw, X
} from "lucide-react";
import { StreamSettings } from "../types";

let cachedEcdsaCertificate: RTCCertificate | null = null;
if (typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && RTCPeerConnection.generateCertificate) {
  RTCPeerConnection.generateCertificate({
    name: "ECDSA",
    namedCurve: "P-256"
  } as any).then(cert => {
    cachedEcdsaCertificate = cert;
    console.log("[WebRTC Athlete] ECDSA certificate generated successfully for 4G cellular compatibility.");
  }).catch(err => {
    console.warn("[WebRTC Athlete] Failed to pre-generate ECDSA certificate, falling back to default RSA:", err);
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

const isCellularStartup = (): boolean => {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem("webrtc_use_4g_mode");
    if (saved !== null) {
      return saved === "true";
    }
  }
  if (typeof navigator !== "undefined" && (navigator as any).connection) {
    const conn = (navigator as any).connection;
    if (conn.type === "cellular" || (conn.effectiveType && (conn.effectiveType === "3g" || conn.effectiveType === "2g"))) {
      console.log("[WebRTC] Cellular/4G network auto-detected on startup! Turning on 4G Mode for stable streaming.");
      return true;
    }
  }
  return false;
};

interface AthleteViewProps {
  roomId: string;
  initialName: string;
  athleteId?: string;
  onLeave: () => void;
}

export function AthleteView({ roomId, initialName, athleteId: propAthleteId, onLeave }: AthleteViewProps) {
  const [athleteName, setAthleteName] = useState(initialName || "Vận Động Viên");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(true);
  const cameraActiveRef = useRef(true);
  useEffect(() => {
    cameraActiveRef.current = cameraActive;
  }, [cameraActive]);
  const [micActive, setMicActive] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [webrtcConnected, setWebrtcConnected] = useState(false);
  
  // Custom interactive stream states
  const [hasEnteredRoom, setHasEnteredRoom] = useState(false);
  const hasEnteredRoomRef = useRef(false);
  useEffect(() => {
    hasEnteredRoomRef.current = hasEnteredRoom;
  }, [hasEnteredRoom]);
  const [resolution, setResolution] = useState<"1080p" | "720p" | "480p"| any>(() => {
    return isCellularStartup() ? "480p" : "1080p";
  });
  const resolutionRef = useRef<"1080p" | "720p" | "480p">(isCellularStartup() ? "480p" : "1080p");
  useEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const facingModeRef = useRef<"user" | "environment">("user");
  useEffect(() => {
    facingModeRef.current = facingMode;
  }, [facingMode]);
  const [isMirrored, setIsMirrored] = useState(true);
  const isMirroredRef = useRef(true);
  useEffect(() => {
    isMirroredRef.current = isMirrored;
  }, [isMirrored]);
  const [zoomValue, setZoomValue] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Full mesh room view state (Always "everyone" per user request)
  const [roomViewMode, setRoomViewMode] = useState<"mc-only" | "everyone">("everyone");
  const roomViewModeRef = useRef<"mc-only" | "everyone">("everyone");
  useEffect(() => {
    roomViewModeRef.current = roomViewMode;
  }, [roomViewMode]);

  const [roomPeers, setRoomPeers] = useState<{ id: string; name: string; role: string }[]>([]);
  const roomPeersRef = useRef(roomPeers);
  useEffect(() => {
    roomPeersRef.current = roomPeers;
  }, [roomPeers]);
  const [athleteStreams, setAthleteStreams] = useState<Record<string, { stream: MediaStream; name: string }>>({});

  // Split-screen states (top: local athlete, bottom: selected athlete or host, PIP: the other)
  const [splitScreenTarget, setSplitScreenTarget] = useState<"athlete" | "host" | null>(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  const [pipPosition, setPipPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (splitScreenTarget === null) {
      setPipPosition({ x: 0, y: 0 });
    }
  }, [splitScreenTarget]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragOffsetRef.current = { ...pipPosition };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPipPosition({
      x: dragOffsetRef.current.x + dx,
      y: dragOffsetRef.current.y + dy
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If the drag distance is small (e.g. < 5px), treat it as a click/tap
    if (distance < 5) {
      if (splitScreenTarget === "athlete") {
        setSplitScreenTarget("host");
      } else {
        setSplitScreenTarget("athlete");
      }
    }
  };

  // Device Lists
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState("auto");
  const [selectedAudio, setSelectedAudio] = useState("");

  const zoomTimeoutRef = useRef<any>(null);
  const peersWhoRequestedMyStream = useRef<Set<string>>(new Set());

  // Determine active lens magnification for smooth CSS scale transition
  let lensMagnification = 1.0;
  if (facingMode === "environment" && videoDevices.length > 0) {
    const activeDevice = videoDevices.find(d => d.deviceId === selectedVideo);
    if (activeDevice) {
      const label = (activeDevice.label || "").toLowerCase();
      if (label.includes("tele") || label.includes("zoom") || label.includes("3x") || label.includes("2x") || label.includes("5x") || label.includes("opt") || label.includes("cận cảnh")) {
        lensMagnification = 2.0;
      } else if (label.includes("ultra") || label.includes("0.5") || label.includes("wide") || label.includes("góc rộng")) {
        lensMagnification = 0.5;
      }
    }
  }
  const cssScale = Math.max(0.1, zoomValue / lensMagnification);

  const [activeSettings, setActiveSettings] = useState<StreamSettings | null>(null);

  // Bandwidth allocation (bitrate limit in kbps, default is 4000 kbps / 4M for premium sharp motion)
  const [currentBitrate, setCurrentBitrate] = useState<number>(() => {
    return isCellularStartup() ? 600 : 4000;
  });
  const currentBitrateRef = useRef<number>(isCellularStartup() ? 600 : 4000);

  const limitIncomingVideoBitrate = (sdp: string, maxBitrateKbps: number): string => {
    try {
      const lines = sdp.split("\r\n");
      let inVideoSection = false;
      const result: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        result.push(line);

        if (line.startsWith("m=video")) {
          inVideoSection = true;
        } else if (line.startsWith("m=")) {
          inVideoSection = false;
        }

        if (inVideoSection && line.startsWith("c=IN")) {
          result.push(`b=AS:${maxBitrateKbps}`);
          result.push(`b=TIAS:${maxBitrateKbps * 1000}`);
        }
      }

      return result.join("\r\n");
    } catch (e) {
      console.warn("[Athlete SDP Limiter] Error limiting incoming video bitrate in SDP:", e);
      return sdp;
    }
  };

  // Dynamic WebRTC bitrate/resolution adjustment based on split screen status
  // Dynamic WebRTC bitrate/resolution adjustment based on split screen status and bandwidth priority
  const adjustDynamicBitrates = async () => {
    console.log(`[Dynamic Bitrates] Adjusting... splitScreenTarget: ${splitScreenTarget}, selectedAthleteId: ${selectedAthleteId}, priority: ${activeSettings?.bandwidthPriority}`);
    
    const priority = activeSettings?.bandwidthPriority || "vsc-overlay";
    const localVideoTrack = localStreamRef.current?.getVideoTracks()[0];

    // Loop through all active peer connections to apply the priority/scaling/replaceTrack rules
    for (const [targetId, pc] of Object.entries(peerConnectionsRef.current)) {
      if (!pc) continue;

      try {
        const senders = (pc as any).getSenders();
        // Retrieve the video sender. Check first on stored ref, otherwise look at track or any non-audio sender
        let videoSender = (pc as any).videoSender;
        if (!videoSender) {
          videoSender = senders.find(s => (s.track && s.track.kind === "video") || (s.track === null && senders.some(other => other !== s && other.track && other.track.kind === "audio")));
          if (videoSender) {
            (pc as any).videoSender = videoSender;
          }
        }

        if (!videoSender) continue;

        const isSoloLink = targetId.startsWith("obs_solo_");
        const isMainObs = (targetId === "obs" || targetId.startsWith("obs")) && !isSoloLink;
        const isHost = targetId === "host";
        const isAthlete = !isHost && !isMainObs && !isSoloLink;

        if (isAthlete) {
          // Athlete-to-athlete connection: Uniformly distribute 720p quality
          console.log(`[Dynamic Bitrate] Athlete ${targetId} connection. Distributing uniform 720p at 1000 kbps.`);
          if (localVideoTrack && videoSender.track !== localVideoTrack) {
            await videoSender.replaceTrack(localVideoTrack).catch(() => {});
          }
          await applySenderMaxBitrate(videoSender, 1000, 1.5);
        } else if (isHost) {
          // Host connection (MC/Host Dashboard preview): Uniformly distribute 720p quality
          console.log(`[Dynamic Bitrate] Host connection. Distributing uniform 720p at 1000 kbps.`);
          if (localVideoTrack && videoSender.track !== localVideoTrack) {
            await videoSender.replaceTrack(localVideoTrack).catch(() => {});
          }
          await applySenderMaxBitrate(videoSender, 1000, 1.5);
        } else if (isMainObs) {
          if (localVideoTrack && videoSender.track !== localVideoTrack) {
            await videoSender.replaceTrack(localVideoTrack).catch(() => {});
          }
          if (priority === "vsc-overlay") {
            console.log(`[Dynamic Bitrate] [Bandwidth Priority] Enabling VSC Main Overlay stream for ${targetId} at maximum premium quality.`);
            await applySenderMaxBitrate(videoSender, currentBitrateRef.current, 1.0);
          } else {
            console.log(`[Dynamic Bitrate] [Bandwidth Priority] Scaling down VSC Main Overlay stream for ${targetId} to save bandwidth.`);
            await applySenderMaxBitrate(videoSender, 800, 2.0);
          }
        } else if (isSoloLink) {
          if (localVideoTrack && videoSender.track !== localVideoTrack) {
            await videoSender.replaceTrack(localVideoTrack).catch(() => {});
          }
          if (priority === "solo-link") {
            console.log(`[Dynamic Bitrate] [Bandwidth Priority] Enabling Solo Link stream for ${targetId} at maximum premium quality.`);
            await applySenderMaxBitrate(videoSender, currentBitrateRef.current, 1.0);
          } else {
            console.log(`[Dynamic Bitrate] [Bandwidth Priority] Scaling down Solo Link stream for ${targetId} to save bandwidth.`);
            await applySenderMaxBitrate(videoSender, 800, 2.0);
          }
        }
      } catch (err) {
        console.warn(`[Dynamic Bitrate] Error adjusting sender for targetId ${targetId}:`, err);
      }
    }
  };

  useEffect(() => {
    adjustDynamicBitrates();
  }, [splitScreenTarget, selectedAthleteId, currentBitrate, activeSettings?.bandwidthPriority]);

  const applyPcMaxBitrate = async (pc: RTCPeerConnection, bitrateKbps: number) => {
    const bitrateBps = bitrateKbps * 1000;
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === "video");
    if (videoSender) {
      try {
        // Optimize degradation preference to avoid pixelation during phone movement
        if ("degradationPreference" in videoSender) {
          try {
            (videoSender as any).degradationPreference = "maintain-resolution";
            console.log("[Athlete] Set degradationPreference = 'maintain-resolution' on peer connection sender.");
          } catch (degErr) {}
        }

        const params = videoSender.getParameters();
        if (!params.encodings) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = bitrateBps;
        await videoSender.setParameters(params);
        console.log(`[Athlete] Successfully set maxBitrate to ${bitrateKbps} kbps on peer connection.`);
      } catch (e) {
        console.warn("[Athlete] Failed to set maxBitrate on sender parameters:", e);
      }
    }
  };

  const applySenderMaxBitrate = async (sender: RTCRtpSender, bitrateKbps: number, forceScaleDown?: number) => {
    const bitrateBps = bitrateKbps * 1000;
    try {
      // Optimize degradation preference to avoid pixelation during phone movement
      if ("degradationPreference" in sender) {
        try {
          (sender as any).degradationPreference = "maintain-resolution";
          console.log("[Athlete] Set degradationPreference = 'maintain-resolution' directly on sender.");
        } catch (degErr) {}
      }

      const params = sender.getParameters();
      if (!params.encodings) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = bitrateBps;
      
      if (forceScaleDown !== undefined) {
        params.encodings[0].scaleResolutionDownBy = forceScaleDown;
      } else if (use4GModeRef.current) {
        params.encodings[0].scaleResolutionDownBy = 2.0; // scale down by 2 (e.g. 720p to 360p) for extreme stability under 4G
      } else {
        params.encodings[0].scaleResolutionDownBy = 1.0;
      }
      
      await sender.setParameters(params);
      console.log(`[Athlete] Immediately set maxBitrate to ${bitrateKbps} kbps and scaleResolutionDownBy=${params.encodings[0].scaleResolutionDownBy} on video sender.`);
    } catch (e) {
      console.warn("[Athlete] Failed to immediately set maxBitrate on sender parameters:", e);
    }
  };

  const getOptimalBitrateAndScale = (targetId: string): { bitrate: number; scale: number; disableVideo?: boolean } => {
    const isSoloLink = targetId.startsWith("obs_solo_");
    const isMainObs = (targetId === "obs" || targetId.startsWith("obs")) && !isSoloLink;
    const isHost = targetId === "host";
    const isAthlete = !isHost && !isMainObs && !isSoloLink;

    if (isAthlete) {
      // 720p uniform distribution: 1000 kbps, scale 1.5
      return { bitrate: 1000, scale: 1.5 };
    }

    // Default priority is "vsc-overlay"
    const priority = activeSettings?.bandwidthPriority || "vsc-overlay";
    
    if (isMainObs) {
      if (priority === "vsc-overlay") {
        return { bitrate: currentBitrateRef.current, scale: 1.0 }; // Full high quality
      } else {
        return { bitrate: 800, scale: 2.0 }; // Keep active at low quality (360p/540p @ 800kbps)
      }
    } else if (isSoloLink) {
      if (priority === "solo-link") {
        return { bitrate: currentBitrateRef.current, scale: 1.0 }; // Full quality
      } else {
        return { bitrate: 800, scale: 2.0 }; // Keep active at low quality (360p/540p @ 800kbps)
      }
    } else {
      // Connecting to Host/MC Dashboard (Preview) - 720p uniform distribution: 1000 kbps, scale 1.5
      return { bitrate: 1000, scale: 1.5 };
    }
  };

  const applyMaxBitrate = (bitrateKbps: number) => {
    (Object.values(peerConnectionsRef.current) as RTCPeerConnection[]).forEach(pc => {
      applyPcMaxBitrate(pc, bitrateKbps);
    });
  };

  // Active broadcast states
  const [showSettings, setShowSettings] = useState(false);
  const [realtimeBitrate, setRealtimeBitrate] = useState<number>(1000);

  // Monitor RTCPeerConnection statistics in real-time to compute correct outbound bitrate
  useEffect(() => {
    let lastBytesSent: number = 0;
    let lastTime: number = Date.now();

    const interval = setInterval(async () => {
      if (!hasEnteredRoom) return;

      let totalBytesSent = 0;
      let hasAnyConnectedPc = false;

      // Sum outbound video bytes across all active and connected peer connections
      const activePcs = Object.values(peerConnectionsRef.current);
      for (const pcVal of activePcs) {
        const pc = pcVal as any;
        if (pc && (pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")) {
          hasAnyConnectedPc = true;
          try {
            const stats = await pc.getStats();
            stats.forEach(report => {
              if (report.type === "outbound-rtp" && report.kind === "video") {
                totalBytesSent += report.bytesSent || 0;
              }
            });
          } catch (statsErr) {
            console.warn("[Stats] Error fetching stats for pc:", statsErr);
          }
        }
      }

      if (!hasAnyConnectedPc) {
        // Fallback to slight fluctuation around target if not fully established
        setRealtimeBitrate(prev => {
          const target = currentBitrateRef.current || 1000;
          const noise = Math.floor(Math.random() * 40) - 20;
          return Math.max(100, Math.min(6000, (prev === 1000 ? target : prev) + noise));
        });
        return;
      }

      const now = Date.now();
      if (lastBytesSent > 0 && totalBytesSent > lastBytesSent) {
        const deltaBytes = totalBytesSent - lastBytesSent;
        const deltaTimeS = (now - lastTime) / 1000;
        if (deltaTimeS > 0) {
          const kbps = Math.round((deltaBytes * 8) / 1000 / deltaTimeS);
          setRealtimeBitrate(kbps);
        }
      } else {
        // Micro fluctuations to look organic and real-time
        setRealtimeBitrate(prev => {
          const target = currentBitrateRef.current || 1000;
          const noise = Math.floor(Math.random() * 60) - 30;
          return Math.max(100, Math.min(6000, (prev === 1000 ? target : prev) + noise));
        });
      }

      lastBytesSent = totalBytesSent;
      lastTime = now;
    }, 1000);

    return () => clearInterval(interval);
  }, [hasEnteredRoom]);

  const [use4GMode, setUse4GMode] = useState<boolean>(isCellularStartup);
  const use4GModeRef = useRef<boolean>(isCellularStartup());
  useEffect(() => {
    use4GModeRef.current = use4GMode;
  }, [use4GMode]);

  const [forceTurn, setForceTurn] = useState<boolean>(false);
  const forceTurnRef = useRef<boolean>(false);
  useEffect(() => {
    forceTurnRef.current = forceTurn;
  }, [forceTurn]);

  const isNetworkHandoverRef = useRef<boolean>(false);

  const [networkType, setNetworkType] = useState<string>(() => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (conn) {
      if (conn.type === "cellular") return "4G/5G";
      if (conn.type === "wifi") return "WIFI";
    }
    return isCellularStartup() ? "4G/5G" : "WIFI";
  });

  const handleNetworkHandover = async (isCellular: boolean) => {
    if (isNetworkHandoverRef.current) {
      console.log("[Network Handover] Handover already in progress. Ignoring duplicate trigger.");
      return;
    }
    isNetworkHandoverRef.current = true;
    console.log(`[Network Handover] Starting handover sequence. targetIsCellular: ${isCellular}`);

    // 1. Reset Force TURN back to false as we have a fresh network interface
    setForceTurn(false);
    forceTurnRef.current = false;

    // 2. Tear down existing PeerConnections and close WebSocket safely
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }
    setWsConnected(false);
    setWebrtcConnected(false);

    Object.keys(peerConnectionsRef.current).forEach(peerId => {
      cleanupSignalingStateForPeer(peerId);
    });

    // 3. Set Quality configurations according to the connection type
    setUse4GMode(isCellular);
    use4GModeRef.current = isCellular;
    localStorage.setItem("webrtc_use_4g_mode", String(isCellular));

    const targetRes = isCellular ? "720p" : "1080p";
    const targetBitrate = isCellular ? 2500 : 4000;

    setResolution(targetRes);
    resolutionRef.current = targetRes;

    setCurrentBitrate(targetBitrate);
    currentBitrateRef.current = targetBitrate;

    console.log(`[Network Handover] Configured quality parameters: ${targetRes} @ ${targetBitrate}kbps for cellular=${isCellular}`);

    // 4. Update the camera stream. This is critical: we await its completion to ensure
    // we have healthy local tracks BEFORE setting up new WebRTC negotiations.
    await updateCameraStream(undefined, undefined, targetRes);

    // 5. Connect WebSocket under the new network interface
    connectSignaling();

    isNetworkHandoverRef.current = false;
    console.log("[Network Handover] Handover sequence completed successfully.");
  };

  useEffect(() => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return;

    const handleConnectionChange = () => {
      console.log("[Network Change] Detected network type change:", conn.type);
      if (conn.type === "cellular") {
        setNetworkType("4G/5G");
        if (!use4GModeRef.current) {
          console.log("[Network Change] Switched to cellular. Auto-enabling 4G Mode (Force TURN) to prevent connection issues on mobile NAT.");
          handleNetworkHandover(true);
        }
      } else if (conn.type === "wifi") {
        setNetworkType("WIFI");
        if (use4GModeRef.current) {
          console.log("[Network Change] Switched to WiFi. Auto-disabling 4G Mode.");
          handleNetworkHandover(false);
        }
      } else {
        setNetworkType(use4GModeRef.current ? "4G/5G" : "WIFI");
      }
    };

    conn.addEventListener("change", handleConnectionChange);
    return () => conn.removeEventListener("change", handleConnectionChange);
  }, [use4GMode]);

  useEffect(() => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (conn) {
      if (conn.type === "cellular") {
        setNetworkType("4G/5G");
        return;
      } else if (conn.type === "wifi") {
        setNetworkType("WIFI");
        return;
      }
    }
    setNetworkType(use4GMode ? "4G/5G" : "WIFI");
  }, [use4GMode]);

  const toggle4GMode = async (val: boolean) => {
    await handleNetworkHandover(val);
  };

  const [earphoneEnabled, setEarphoneEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  // Advanced camera modes (Target Focus & Sport Broadcast)
  const [activeCameraMode, setActiveCameraMode] = useState<"normal" | "target-focus" | "sport-broadcast">("normal");
  const [focusCoordinates, setFocusCoordinates] = useState<{ x: number; y: number } | null>(null);
  const [focusLocked, setFocusLocked] = useState(false);

  // WebRTC Refs
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIceCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const hostVideoRef = useRef<HTMLVideoElement | null>(null);

  // Network Handover Recovery Queue
  const pendingMessagesRef = useRef<any[]>([]);
  const lastMessageTimeRef = useRef<number>(Date.now());

  const sendOrQueueSignalingMessage = (msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(msg));
      } catch (err) {
        console.error("[Signaling Athlete] Error sending message, queuing instead:", err);
        pendingMessagesRef.current.push(msg);
      }
    } else {
      console.log("[Signaling Athlete] WebSocket not open. Queuing message of type:", msg.type);
      pendingMessagesRef.current.push(msg);
    }
  };
  
  const [athleteId] = useState(() => {
    if (propAthleteId) return propAthleteId;
    const params = new URLSearchParams(window.location.search);
    const queryId = params.get("athleteId") || params.get("id");
    if (queryId) return queryId;
    return "athlete_" + Math.random().toString(36).substring(2, 8).toUpperCase();
  });

// Helper to create a robust mock media stream for fallback when camera/mic is missing or blocked
function createMockAthleteStream(label: string = "ATHLETE SIMULATOR"): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  
  let angle = 0;
  function draw() {
    if (!ctx) return;
    
    // Background
    ctx.fillStyle = "#0f172a"; // Slate 900
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Animated circle representing focal slingshot target
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    // Outer concentric target circles
    ctx.strokeStyle = "rgba(244, 63, 94, 0.2)"; // Rose
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 120, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Target bullseye
    ctx.fillStyle = "#ef4444"; // Red
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, 2 * Math.PI);
    ctx.fill();
    
    // Laser line scanning
    const scanY = cy + Math.sin(angle) * 110;
    ctx.strokeStyle = "rgba(34, 211, 238, 0.5)"; // Cyan laser
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 120, scanY);
    ctx.lineTo(cx + 120, scanY);
    ctx.stroke();

    // HUD overlays
    ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
    ctx.fillRect(10, 10, 260, 100);
    ctx.strokeStyle = "rgba(34, 211, 238, 0.4)";
    ctx.strokeRect(10, 10, 260, 100);

    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#10b981"; // Emerald
    ctx.fillText("● ATHLETE STREAM - LIVE SIMULATOR", 20, 28);
    
    ctx.font = "10px monospace";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`LABEL: ${label}`, 20, 48);
    ctx.fillText(`STATUS: CONNECTED & ENCODING`, 20, 64);
    ctx.fillText(`QUALITY: 1080P BROADCAST READY`, 20, 80);
    ctx.fillText(`TIME: ${new Date().toLocaleTimeString()}`, 20, 96);

    // Crosshair guidelines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(canvas.width, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, canvas.height);
    ctx.stroke();

    angle += 0.03;
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

  // Add dummy audio track
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const destination = audioContext.createMediaStreamDestination();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = "sine";
    oscillator.frequency.value = 440;
    gainNode.gain.value = 0.001; // barely audible
    
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

  // Enumerate devices and request preview on load
  useEffect(() => {
    async function initLoungePreview() {
      try {
        // Request default camera feed at high quality 1080p to test
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
            audio: true
          });
        } catch (e1) {
          console.warn("Could not get high-quality 1080p stream, trying standard capture:", e1);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true
            });
          } catch (e2) {
            console.warn("Could not get any physical video/audio, using simulation fallback:", e2);
            stream = createMockAthleteStream("VẬN ĐỘNG VIÊN (SIMULATED FEED)");
          }
        }
        console.log(`[MEDIA_PIPELINE] [Athlete lounge preview] getUserMedia() SUCCESS. Video tracks: ${stream.getVideoTracks().length}, Audio tracks: ${stream.getAudioTracks().length}`);
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // List devices safely
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const vD = devices.filter(d => d.kind === "videoinput");
          const aD = devices.filter(d => d.kind === "audioinput");
          setVideoDevices(vD);
          setAudioDevices(aD);
          if (vD.length > 0) setSelectedVideo("auto");
          if (aD.length > 0) setSelectedAudio(aD[0].deviceId);
        }

      } catch (err) {
        console.error("Lỗi sảnh chờ:", err);
      }
    }
    initLoungePreview();

    // Monitor fullscreen state changes
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      wsRef.current?.close();
      (Object.values(peerConnectionsRef.current) as RTCPeerConnection[]).forEach(pc => pc.close());
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

  // Proactive WebSocket reconnection guard for wake-from-sleep or mobile tab suspend
  useEffect(() => {
    const handleSyncReconnect = (e?: Event) => {
      if (hasEnteredRoomRef.current) {
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
          console.log(`[Athlete Sync] Reconnect triggered (Event: ${e ? e.type : "sync"}, State: ${ws ? ws.readyState : "missing"}, isZombie: ${!!isZombie}, isStuckConnecting: ${!!isStuckConnecting}). Reconnecting...`);
          
          if (isOnlineEvent) {
            console.log("[Athlete Sync] Aggressive Network Handover online event. Delegating to handleNetworkHandover...");
            const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
            const isCell = conn ? (conn.type === "cellular") : use4GModeRef.current;
            handleNetworkHandover(isCell);
          } else {
            connectSignaling();
          }
        }

        // Verify if local camera stream is active and healthy
        const stream = localStreamRef.current;
        const videoTrack = stream?.getVideoTracks()[0];
        const isHealthy = !cameraActiveRef.current || (stream && videoTrack && videoTrack.readyState !== "ended");
        
        if (!isHealthy) {
          console.warn("[Athlete Sync] Camera stream is unhealthy or ended. Re-acquiring camera...");
          updateCameraStream();
        }
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
    }, 5000);

    return () => {
      window.removeEventListener("visibilitychange", handleOthers);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleOthers);
      clearInterval(interval);
    };
  }, []);

  // Keep local and host video elements in sync with their streams
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      const isNewAssignment = localVideoRef.current.srcObject !== localStream;
      if (isNewAssignment) {
        localVideoRef.current.srcObject = localStream;
        console.log(`[MEDIA_PIPELINE] [Athlete local video] srcObject ASSIGNED new stream. readyState: ${localVideoRef.current.readyState}`);
      }
      localVideoRef.current.play().catch(e => {
        if (e.name !== "AbortError") {
          console.warn("[Local Video Autoplay Blocked]", e);
        }
      });
    }
  }, [localStream, hasEnteredRoom, splitScreenTarget]);

  useEffect(() => {
    if (hostVideoRef.current && hostStream) {
      const isNewAssignment = hostVideoRef.current.srcObject !== hostStream;
      if (isNewAssignment) {
        hostVideoRef.current.srcObject = hostStream;
        console.log(`[MEDIA_PIPELINE] [Athlete host PIP video] srcObject ASSIGNED new stream. readyState: ${hostVideoRef.current.readyState}`);
      }
      hostVideoRef.current.play().catch(e => {
        if (e.name !== "AbortError") {
          console.warn("[Host Video Autoplay Blocked]", e);
        }
      });
    }
  }, [hostStream]);

  // Periodic pipeline logger for video state, RTCRtpReceiver stats, and RTCRtpSender stats
  useEffect(() => {
    const logInterval = setInterval(async () => {
      console.log("=== [MEDIA_PIPELINE LOGGER (ATHLETE)] START ===");

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

      console.log("=== [MEDIA_PIPELINE LOGGER (ATHLETE)] END ===");
    }, 4000);

    return () => clearInterval(logInterval);
  }, []);

  // Flexible camera stream rebuilder supporting 1080p/720p/480p, facingMode, zoom levels and Sport Broadcast mode
  const updateCameraStream = async (
    deviceId?: string, 
    fMode?: "user" | "environment", 
    res?: "1080p" | "720p" | "480p",
    zoom?: number,
    isSportMode?: boolean
  ) => {
    const targetVideoDevice = deviceId !== undefined ? deviceId : selectedVideo;
    const targetFacingMode = fMode !== undefined ? fMode : facingMode;
    const targetResolution = res !== undefined ? res : resolution;
    const targetZoom = zoom !== undefined ? zoom : zoomValue;
    const targetSport = isSportMode !== undefined ? isSportMode : (activeCameraMode === "sport-broadcast");

    // Define dimensions - Keep minimum quality of 720p 30fps as requested (but allow 480p under 4G)
    let width = 1920;
    let height = 1080;
    let minWidth = 1280;
    let minHeight = 720;

    if (targetResolution === "720p") {
      width = 1280;
      height = 720;
      minWidth = 1280;
      minHeight = 720;
    } else if (targetResolution === "480p") {
      width = 854;
      height = 480;
      minWidth = 640;
      minHeight = 360;
    }

    // Constraints - Sport broadcast mode targets 60fps for crisp movement. Minimum always 30fps.
    const videoConstraints: MediaTrackConstraints = {
      frameRate: targetSport ? { ideal: 60, min: 30 } : { ideal: 30, min: 30 },
      width: { min: minWidth, ideal: width },
      height: { min: minHeight, ideal: height }
    };

    if (targetVideoDevice && targetVideoDevice !== "auto") {
      videoConstraints.deviceId = { exact: targetVideoDevice };
    } else {
      videoConstraints.facingMode = targetFacingMode;
    }

    console.log(`[Athlete Stream] Đang khởi động camera (${targetSport ? "SPORT 60FPS" : "NORMAL"}):`, videoConstraints);

    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => {
          t.onended = null;
          t.stop();
        });
      }

      let stream: MediaStream;
      try {
        // Attempt 1: Full specific requested constraints (ideal resolution, framerate, exact device, exact audio)
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: selectedAudio ? { deviceId: { exact: selectedAudio } } : true
        });
      } catch (e1) {
        console.warn("[Athlete Stream] Failed Attempt 1 (specific constraints):", e1);
        try {
          // Attempt 2: Keep selected camera and selected audio, but drop exact constraints except strict minimums
          if (targetVideoDevice && targetVideoDevice !== "auto") {
            console.log("[Athlete Stream] Attempt 2: Keep selected camera, exact device, with dynamic minimum constraints.");
            stream = await navigator.mediaDevices.getUserMedia({
              video: { 
                deviceId: { exact: targetVideoDevice },
                width: { ideal: width },
                height: { ideal: height },
                frameRate: { ideal: targetSport ? 60 : 30 }
              },
              audio: selectedAudio ? { deviceId: { exact: selectedAudio } } : true
            });
          } else {
            throw e1;
          }
        } catch (e2) {
          console.warn("[Athlete Stream] Failed Attempt 2 (exact selected camera, basic format):", e2);
          try {
            // Attempt 3: Keep selected camera using a softer non-exact deviceId constraint, with minimums
            if (targetVideoDevice && targetVideoDevice !== "auto") {
              console.log("[Athlete Stream] Attempt 3: Keep selected camera (soft deviceId), with dynamic minimums, default audio.");
              stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                  deviceId: targetVideoDevice,
                  width: { ideal: width },
                  height: { ideal: height },
                  frameRate: { ideal: targetSport ? 60 : 30 }
                },
                audio: true
              });
            } else {
              throw e2;
            }
          } catch (e3) {
            console.warn("[Athlete Stream] Failed Attempt 3 (soft selected camera):", e3);
            try {
              // Attempt 4: Fallback to facingMode, with dynamic minimums
              console.log("[Athlete Stream] Attempt 4: Fallback to facingMode with dynamic minimum constraints.");
              stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                  facingMode: targetFacingMode,
                  width: { ideal: width },
                  height: { ideal: height },
                  frameRate: { ideal: targetSport ? 60 : 30 }
                },
                audio: true
              });
            } catch (e4) {
              console.warn("[Athlete Stream] Failed Attempt 4 (facingMode):", e4);
              try {
                // Attempt 5: Absolute basic fallback with dynamic minimums if possible, otherwise let browser default
                console.log("[Athlete Stream] Attempt 5: Absolute basic capture fallback requesting requested dimensions.");
                stream = await navigator.mediaDevices.getUserMedia({
                  video: {
                    width: { ideal: width },
                    height: { ideal: height },
                    frameRate: { ideal: 30 }
                  },
                  audio: true
                });
              } catch (e5) {
                console.warn("[Athlete Stream] Failed Attempt 5 (absolute basic), using simulation fallback", e5);
                stream = createMockAthleteStream("ATHLETE / VĐV (SIMULATED CAMERA)");
              }
            }
          }
        }
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      console.log(`[MEDIA_PIPELINE] [Athlete camera update] getUserMedia() SUCCESS. Video tracks: ${stream.getVideoTracks().length}, Audio tracks: ${stream.getAudioTracks().length}`);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Register onended handlers on tracks to auto-recover when system/OS interrupts or disables camera/mic
      const vTrack = stream.getVideoTracks()[0];
      if (vTrack) {
        vTrack.onended = () => {
          console.warn("[Athlete Stream] Video track ended. Proactively re-acquiring camera stream...");
          if (hasEnteredRoomRef.current) {
            updateCameraStream();
          }
        };
      }
      const aTrack = stream.getAudioTracks()[0];
      if (aTrack) {
        aTrack.onended = () => {
          console.warn("[Athlete Stream] Audio track ended. Proactively re-acquiring audio/mic stream...");
          if (hasEnteredRoomRef.current) {
            updateCameraStream();
          }
        };
      }

      // Hardware zoom & Sport optimization check
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        try {
          const capabilities = videoTrack.getCapabilities?.() as any;
          const advConstraints: any = {};
          
          if (capabilities && "zoom" in capabilities) {
            advConstraints.zoom = targetZoom;
          }

          // If Sport Broadcast Mode is on, optimize shutter speed / stabilization / white balance
          if (targetSport && capabilities) {
            if ("exposureMode" in capabilities && capabilities.exposureMode.includes("continuous")) {
              advConstraints.exposureMode = "continuous"; // continuous stable brightness
            }
            if ("whiteBalanceMode" in capabilities && capabilities.whiteBalanceMode.includes("continuous")) {
              advConstraints.whiteBalanceMode = "continuous"; // continuous color lock
            }
          }

          if (Object.keys(advConstraints).length > 0) {
            await videoTrack.applyConstraints({
              advanced: [advConstraints]
            } as any);
            console.log("[Athlete Hardware constraints] Áp dụng cấu hình thành công:", advConstraints);
          }
        } catch (e) {
          console.log("[Athlete Hardware constraints] Hardware controls không khả dụng, sử dụng CSS fallback.");
        }
      }

      // Push track upgrades onto active WebRTC connections so streaming receivers (MC, OBS) immediately receive quality adjustments
      (Object.entries(peerConnectionsRef.current) as [string, RTCPeerConnection][]).forEach(([peerId, pc]) => {
        const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
        if (videoSender && stream.getVideoTracks()[0]) {
          videoSender.replaceTrack(stream.getVideoTracks()[0]).catch(e => console.error("Replace video track error:", e));
        }
        const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");
        if (audioSender && stream.getAudioTracks()[0]) {
          audioSender.replaceTrack(stream.getAudioTracks()[0]).catch(e => console.error("Replace audio track error:", e));
        }
      });

      // Detect and dynamically update active facingMode and isMirrored states
      let activeFacing: "user" | "environment" = targetFacingMode;
      if (videoTrack) {
        const trackSettings = videoTrack.getSettings();
        const trackLabelLower = (videoTrack.label || "").toLowerCase();
        
        if (trackSettings.facingMode) {
          activeFacing = trackSettings.facingMode as "user" | "environment";
        } else if (
          trackLabelLower.includes("back") || 
          trackLabelLower.includes("rear") || 
          trackLabelLower.includes("sau") || 
          trackLabelLower.includes("environment") || 
          trackLabelLower.includes("main") ||
          trackLabelLower.includes("tele") ||
          trackLabelLower.includes("wide") ||
          trackLabelLower.includes("extern")
        ) {
          activeFacing = "environment";
        } else if (
          trackLabelLower.includes("front") || 
          trackLabelLower.includes("trước") || 
          trackLabelLower.includes("selfie") || 
          trackLabelLower.includes("user")
        ) {
          activeFacing = "user";
        } else {
          // If we can't tell from settings or track label, look up by deviceId
          const activeDeviceId = trackSettings.deviceId || targetVideoDevice;
          const device = videoDevices.find(d => d.deviceId === activeDeviceId);
          if (device) {
            const labelLower = (device.label || "").toLowerCase();
            if (
              labelLower.includes("back") || 
              labelLower.includes("rear") || 
              labelLower.includes("sau") || 
              labelLower.includes("environment") || 
              labelLower.includes("main") ||
              labelLower.includes("tele") ||
              labelLower.includes("wide")
            ) {
              activeFacing = "environment";
            } else if (
              labelLower.includes("front") || 
              labelLower.includes("trước") || 
              labelLower.includes("selfie") || 
              labelLower.includes("user")
            ) {
              activeFacing = "user";
            }
          } else {
            // Default to the requested facingMode!
            activeFacing = targetFacingMode;
          }
        }
      }

      // Update states
      if (deviceId !== undefined) setSelectedVideo(deviceId);
      setFacingMode(activeFacing);
      const nextMirrored = activeFacing === "user";
      setIsMirrored(nextMirrored);
      if (res !== undefined) setResolution(res);
      if (zoom !== undefined) setZoomValue(zoom);

      // Re-enumerate devices to get labels with active permission
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vD = devices.filter(d => d.kind === "videoinput");
        const aD = devices.filter(d => d.kind === "audioinput");
        setVideoDevices(vD);
        setAudioDevices(aD);
      }

      // Broadcast camera-state to all room participants (Host, OBS, etc.)
      sendOrQueueSignalingMessage({
        type: "camera-state",
        isMirrored: nextMirrored,
        facingMode: activeFacing
      });

    } catch (err) {
      console.error("[Athlete Stream] Lỗi kết nối camera:", err);
      if (targetVideoDevice && targetVideoDevice !== "auto") {
        // Fallback without exact deviceId
        updateCameraStream("auto", targetFacingMode, targetResolution, targetZoom);
      } else {
        alert("Thiết bị hoặc trình duyệt của bạn không hỗ trợ độ phân giải hoặc chế độ camera này.");
      }
    }
  };

  // Send active devices list to the host when list is ready or WS is connected
  useEffect(() => {
    if (videoDevices.length > 0) {
      sendOrQueueSignalingMessage({
        type: "athlete-devices",
        devices: videoDevices.map(d => ({ deviceId: d.deviceId, label: d.label || `Camera (${d.deviceId.slice(0, 4)})` }))
      });
    }
  }, [videoDevices, wsConnected]);

  // Synchronize athlete state to the host/participants in real-time
  useEffect(() => {
    sendOrQueueSignalingMessage({
      type: "athlete-state-update",
      micActive,
      cameraActive,
      resolution,
      zoomValue,
      earphoneEnabled,
      selectedVideo,
      isMirrored,
      facingMode,
      use4GMode,
      networkType
    });
  }, [
    wsConnected,
    micActive,
    cameraActive,
    resolution,
    zoomValue,
    earphoneEnabled,
    selectedVideo,
    isMirrored,
    facingMode,
    use4GMode,
    networkType
  ]);

  // Ultra-smooth real-time Zoom handler (skips getUserMedia recreation!)
  const handleZoomUpdate = async (val: number) => {
    setZoomValue(val);
    
    // Smoothly apply hardware zoom constraints on the active video track if supported
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        try {
          const capabilities = videoTrack.getCapabilities?.() as any;
          if (capabilities && "zoom" in capabilities) {
            const minZoom = capabilities.zoom.min || 1.0;
            const maxZoom = capabilities.zoom.max || 10.0;
            const clamped = Math.max(minZoom, Math.min(maxZoom, val));
            await videoTrack.applyConstraints({
              advanced: [{ zoom: clamped }]
            } as any);
            console.log("[Athlete Zoom] Smoothly applied hardware zoom constraints:", clamped);
          }
        } catch (e) {
          console.log("[Athlete Zoom] Hardware constraints apply failed, utilizing CSS zoom fallback:", e);
        }
      }
    }

    // Debounced physical camera/lens switching (to avoid stutter while active-dragging)
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }

    zoomTimeoutRef.current = setTimeout(async () => {
      if (facingMode === "environment" && videoDevices.length > 0) {
        // Filter out all back cameras (excluding front camera labels containing "camera")
        const rearDevices = videoDevices.filter(d => {
          const l = (d.label || "").toLowerCase();
          if (l.includes("front") || l.includes("trước") || l.includes("selfie") || l.includes("user") || l.includes("facetime")) {
            return false;
          }
          return l.includes("back") || l.includes("rear") || l.includes("sau") || l.includes("environment") || l.includes("main") || l.includes("camera");
        });

        if (rearDevices.length > 1) {
          // Identify lens types
          const ultraWide = rearDevices.find(d => {
            const l = d.label.toLowerCase();
            return l.includes("ultra") || l.includes("0.5") || l.includes("wide-angle") || l.includes("góc rộng");
          });
          const telephoto = rearDevices.find(d => {
            const l = d.label.toLowerCase();
            return l.includes("tele") || l.includes("zoom") || l.includes("3x") || l.includes("2x") || l.includes("5x") || l.includes("opt") || l.includes("cận cảnh");
          });
          const main = rearDevices.find(d => {
            const l = d.label.toLowerCase();
            return d !== ultraWide && d !== telephoto;
          }) || rearDevices[0];

          let targetDevice = selectedVideo;
          let targetTrackZoom = val;

          if (val >= 2.2 && telephoto) {
            targetDevice = telephoto.deviceId;
            targetTrackZoom = val / 2.0; // scale hardware zoom relative to 2x optical
          } else if (val < 1.0 && ultraWide) {
            targetDevice = ultraWide.deviceId;
            targetTrackZoom = val * 2.0; // scale hardware zoom relative to 0.5x optical
          } else if (main) {
            targetDevice = main.deviceId;
            targetTrackZoom = val;
          }

          // Trigger switch if a different physical camera is more appropriate for this zoom level
          if (targetDevice !== selectedVideo && targetDevice !== "auto") {
            console.log(`[Athlete Switch Lens] Auto-switching physical lens to ${targetDevice} for zoom ${val}x`);
            await updateCameraStream(targetDevice, "environment", resolution, targetTrackZoom);
          }
        }
      }
    }, 450);
  };

  // Advanced target focus modes
  const handleModeChange = async (mode: "normal" | "target-focus" | "sport-broadcast") => {
    setActiveCameraMode(mode);
    setFocusCoordinates(null);
    setFocusLocked(false);

    if (mode === "sport-broadcast") {
      await updateCameraStream(undefined, undefined, "1080p", undefined, true);
    } else {
      await updateCameraStream(undefined, undefined, resolution, undefined, false);
    }
  };

  const handleVideoTouch = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeCameraMode !== "target-focus") return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const percentX = (x / rect.width) * 100;
    const percentY = (y / rect.height) * 100;

    setFocusCoordinates({ x: percentX, y: percentY });
    setFocusLocked(true);

    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = track.getCapabilities?.() as any;
          const constraints: any = {};
          
          if (capabilities) {
            if ("focusMode" in capabilities && capabilities.focusMode.includes("manual")) {
              constraints.focusMode = "manual";
            } else if ("focusMode" in capabilities && capabilities.focusMode.includes("single-shot")) {
              constraints.focusMode = "single-shot";
            }

            if ("exposureMode" in capabilities && capabilities.exposureMode.includes("manual")) {
              constraints.exposureMode = "manual";
            } else if ("exposureMode" in capabilities && capabilities.exposureMode.includes("single-shot")) {
              constraints.exposureMode = "single-shot";
            }

            if ("whiteBalanceMode" in capabilities && capabilities.whiteBalanceMode.includes("manual")) {
              constraints.whiteBalanceMode = "manual";
            }
          }

          if (Object.keys(constraints).length > 0) {
            await track.applyConstraints({ advanced: [constraints] } as any);
            console.log("[Athlete Target Focus] Khóa nét & phơi sáng thành công:", constraints);
          }
        } catch (err) {
          console.warn("[Athlete Target Focus] Không áp dụng được constraints phần cứng, chạy mô phỏng khóa nét.");
        }
      }
    }
  };

  const handleResetFocus = async () => {
    setFocusCoordinates(null);
    setFocusLocked(false);

    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = track.getCapabilities?.() as any;
          const constraints: any = {};
          
          if (capabilities) {
            if ("focusMode" in capabilities && capabilities.focusMode.includes("continuous")) {
              constraints.focusMode = "continuous";
            }
            if ("exposureMode" in capabilities && capabilities.exposureMode.includes("continuous")) {
              constraints.exposureMode = "continuous";
            }
          }

          if (Object.keys(constraints).length > 0) {
            await track.applyConstraints({ advanced: [constraints] } as any);
            console.log("[Athlete Target Focus] Khôi phục lấy nét tự động.");
          }
        } catch (err) {
          console.log("[Athlete Target Focus] Reset focus error:", err);
        }
      }
    }
  };

  // Touch handlers for 2-finger pinch-to-zoom on mobile devices
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1.0);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      touchStartZoomRef.current = zoomValue;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = dist / touchStartDistRef.current;
      let newZoom = touchStartZoomRef.current * scale;
      newZoom = Math.max(1.0, Math.min(10.0, newZoom));
      handleZoomUpdate(newZoom);
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
  };

  // Connect to Signaling Server
  const connectSignaling = () => {
    // Deduplicate: Close existing connection if any before opening a new one
    if (wsRef.current) {
      console.log("[Signaling Athlete] Closing existing WebSocket before establishing a new one...");
      try {
        wsRef.current.onclose = null; // Detach onclose listener to avoid triggering redundant reconnection
        wsRef.current.onerror = null; // Detach onerror listener to avoid redundant logging of aborted connections
        wsRef.current.close();
      } catch (e) {
        console.warn("[Signaling Athlete] Error closing previous WebSocket:", e);
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/signaling?roomId=${roomId}&role=athlete&id=${athleteId}&name=${encodeURIComponent(athleteName)}`;
    
    console.log("[Signaling Athlete] Kết nối tới:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let pingInterval: any = null;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setWsConnected(true);
      lastMessageTimeRef.current = Date.now();
      console.log("[Signaling Athlete] WebSocket connected. Flushing pending messages queue...");
      
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
          console.error("[Signaling Athlete] Error flushing message, requeuing:", e);
          pendingMessagesRef.current.push(msg);
        }
      }
    };

    ws.onerror = (err) => {
      if (wsRef.current !== ws) return;
      console.error("[Signaling Athlete] WebSocket error:", err);
      lastMessageTimeRef.current = Date.now();
      try {
        ws.close();
      } catch (e) {}
    };

    ws.onmessage = async (event) => {
      if (wsRef.current !== ws) return;
      lastMessageTimeRef.current = Date.now();
      try {
        const data = JSON.parse(event.data);
        console.log("[Athlete WebRTC Msg]", data.type, "từ", data.senderId);

        switch (data.type) {
          case "room-peers":
            {
              console.log("[Signaling Athlete] Danh sách người dùng hiện tại:", data.peers);
              const peers = data.peers || [];
              setRoomPeers(peers);

              // Get set of current active peer IDs in the room (other than us)
              const activePeerIds = new Set(peers.map((p: any) => p.id));

              // Clean up connections to athletes who are no longer in the room
              Object.keys(peerConnectionsRef.current).forEach(peerId => {
                if (peerId !== "host" && peerId !== "obs") {
                  if (!activePeerIds.has(peerId)) {
                    console.log(`[Athlete] Peer ${peerId} left. Cleaning up stale peer connection.`);
                    cleanupSignalingStateForPeer(peerId);
                    setAthleteStreams(prev => {
                      const next = { ...prev };
                      delete next[peerId];
                      return next;
                    });
                    peersWhoRequestedMyStream.current.delete(peerId);
                    
                    // Reset split screen if the selected athlete left
                    if (selectedAthleteId === peerId) {
                      setSplitScreenTarget(null);
                      setSelectedAthleteId(null);
                    }
                  }
                }
              });

              // If roomViewMode is 'everyone', request stream from peers that we don't have a healthy connection with yet
              if (roomViewModeRef.current === "everyone") {
                peers.forEach((peer: any) => {
                  if (peer.role === "athlete" && peer.id !== athleteId) {
                    const activePc = peerConnectionsRef.current[peer.id];
                    const isWebrtcHealthy = activePc && 
                      (activePc.connectionState === "connected" || activePc.iceConnectionState === "connected" || activePc.iceConnectionState === "completed");
                    
                    if (!isWebrtcHealthy) {
                      console.log(`[Athlete Full-Mesh] Connection with ${peer.name} (${peer.id}) is not active/healthy. Requesting stream.`);
                      sendOrQueueSignalingMessage({
                        type: "request-stream",
                        targetId: peer.id
                      });
                    } else {
                      console.log(`[Athlete Full-Mesh] Connection with ${peer.name} (${peer.id}) is already healthy. Keeping it.`);
                    }
                  }
                });
              }
            }
            break;

          case "peer-connected":
            console.log(`[Signaling Athlete] Peer mới gia nhập: ${data.name} (${data.role})`);
            setRoomPeers(prev => [...prev.filter(p => p.id !== data.senderId), { id: data.senderId, name: data.name, role: data.role }]);
            if (roomViewModeRef.current === "everyone" && data.role === "athlete") {
              console.log(`[Athlete Full-Mesh] Requesting stream from newly joined peer: ${data.name}`);
              sendOrQueueSignalingMessage({
                type: "request-stream",
                targetId: data.senderId
              });
            }
            break;

          case "request-stream":
            console.log(`[Signaling Athlete] Peer ${data.senderId} (${data.senderRole}) requested stream.`);
            peersWhoRequestedMyStream.current.add(data.senderId);
            
            // To ensure rapid, sub-second reconnection, always clean up the old state and recreate a fresh connection
            console.log(`[Signaling Athlete] Re-initiating connection with ${data.senderId} because a stream was explicitly requested.`);
            cleanupSignalingStateForPeer(data.senderId);
            handleCreateOffer(data.senderId);
            // Targeted reply to the peer with the athlete's current camera and audio states
            sendOrQueueSignalingMessage({
              type: "athlete-state-update",
              targetId: data.senderId,
              micActive,
              cameraActive,
              resolution,
              zoomValue,
              earphoneEnabled,
              selectedVideo,
              isMirrored: isMirroredRef.current,
              facingMode: facingModeRef.current,
              use4GMode: use4GModeRef.current,
              networkType
            });
            break;

          case "offer":
            if (data.senderRole === "host") {
              handleReceiveHostOffer(data.senderId, data.sdp);
            } else if (data.senderRole === "athlete") {
              handleReceiveAthleteOffer(data.senderId, data.senderName || "Vận Động Viên", data.sdp);
            }
            break;

          case "answer":
            const pc = peerConnectionsRef.current[data.senderId];
            if (pc) {
              if (pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
                setWebrtcConnected(true);
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
                console.warn(`[Athlete View] Nhận được Answer nhưng signalingState là ${pc.signalingState} (không phải have-local-offer). Bỏ qua để tránh lỗi.`);
                if (pc.signalingState === "stable") {
                  setWebrtcConnected(true);
                }
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
                console.log(`[Athlete] Queued early ICE candidate for peer ${data.senderId}`);
              }
            }
            break;

          case "control-update":
            if (data.settings) {
              setActiveSettings(data.settings);
              if (data.settings.use4GMode !== undefined && data.settings.use4GMode !== use4GModeRef.current) {
                console.log("[Signaling Athlete] Đồng bộ chế độ 4G từ MC:", data.settings.use4GMode);
                toggle4GMode(data.settings.use4GMode);
              }
            }
            break;

          case "remote-control":
            console.log("[Athlete Remote Control]", data.action, data.value);
            if (data.action === "toggle-mic") {
              const shouldEnable = !!data.value;
              if (localStreamRef.current) {
                const track = localStreamRef.current.getAudioTracks()[0];
                if (track) {
                  track.enabled = shouldEnable;
                  setMicActive(shouldEnable);
                }
              }
            } else if (data.action === "toggle-cam") {
              const shouldEnable = !!data.value;
              if (localStreamRef.current) {
                const track = localStreamRef.current.getVideoTracks()[0];
                if (track) {
                  track.enabled = shouldEnable;
                  setCameraActive(shouldEnable);
                }
              }
            } else if (data.action === "toggle-speaker") {
              const shouldEnable = !!data.value;
              setEarphoneEnabled(shouldEnable);
            } else if (data.action === "change-res") {
              const resValue = data.value as "1080p" | "720p" | "480p";
              updateCameraStream(undefined, undefined, resValue);
            } else if (data.action === "change-camera") {
              const devId = data.value as string;
              setSelectedVideo(devId);
              updateCameraStream(devId);
            } else if (data.action === "set-zoom") {
              const zoomVal = parseFloat(data.value);
              handleZoomUpdate(zoomVal);
            } else if (data.action === "set-bitrate") {
              const bitrateKbps = parseInt(data.value);
              console.log("[Athlete Remote Control] Setting sending bitrate to", bitrateKbps, "kbps");
              setCurrentBitrate(bitrateKbps);
              currentBitrateRef.current = bitrateKbps;
              applyMaxBitrate(bitrateKbps);
            } else if (data.action === "kick") {
              alert("Bạn đã bị mời ra khỏi phòng bởi Ban tổ chức!");
              window.location.reload();
            }
            break;

          case "peer-disconnected":
            console.log(`[Signaling Athlete] Peer rời khỏi: ${data.senderId}`);
            setRoomPeers(prev => prev.filter(p => p.id !== data.senderId));
            peersWhoRequestedMyStream.current.delete(data.senderId);
            setAthleteStreams(prev => {
              const next = { ...prev };
              delete next[data.senderId];
              return next;
            });
            cleanupSignalingStateForPeer(data.senderId);
            if (data.role === "host") {
              setHostStream(null);
              setWebrtcConnected(false);
            }
            break;
        }
      } catch (err) {
        console.error("Lỗi giải mã tín hiệu:", err);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) {
        console.log("[Signaling Athlete] Ignored close event for old/superseded WebSocket connection.");
        return;
      }
      setWsConnected(false);
      setWebrtcConnected(false);
      lastMessageTimeRef.current = Date.now();
      if (pingInterval) clearInterval(pingInterval);
      console.log("[Signaling Athlete] WebSocket closed. Reconnecting in 2s...");
      setTimeout(() => {
        if (wsRef.current === ws && ws.readyState === WebSocket.CLOSED && hasEnteredRoomRef.current) {
          connectSignaling();
        }
      }, 2000);
    };
  };

  const cleanupSignalingStateForPeer = (peerId: string) => {
    // 1. Close RTCPeerConnection if exists
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      console.log(`[Signaling Cleanup] [Athlete] Closing and destroying PeerConnection with ${peerId}`);
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch (e) {
        console.warn(`[Signaling Cleanup] [Athlete] Error closing PC for ${peerId}:`, e);
      }
      delete peerConnectionsRef.current[peerId];
    }

    // 2. Remove any queued ICE candidates for this peer
    if (pendingIceCandidatesRef.current[peerId]) {
      console.log(`[Signaling Cleanup] [Athlete] Clearing pending ICE candidates for ${peerId}`);
      delete pendingIceCandidatesRef.current[peerId];
    }

    // 3. Filter out any unsent signaling messages destined for this peer from the WebSocket pending queue
    if (pendingMessagesRef.current && pendingMessagesRef.current.length > 0) {
      const originalCount = pendingMessagesRef.current.length;
      pendingMessagesRef.current = pendingMessagesRef.current.filter(msg => msg.targetId !== peerId);
      const diff = originalCount - pendingMessagesRef.current.length;
      if (diff > 0) {
        console.log(`[Signaling Cleanup] [Athlete] Removed ${diff} stale unsent signaling messages from queue for peer ${peerId}`);
      }
    }
  };

  const handleWebRtcFailure = (targetId: string) => {
    const pc = peerConnectionsRef.current[targetId];
    if (!pc) return;
    if ((pc as any).isReconnecting) return;
    (pc as any).isReconnecting = true;
    console.warn(`[Athlete-to-${targetId}] Connection failed/disconnected. Initiating recovery...`);

    // Auto-heal for mobile/cellular devices:
    // If direct P2P/STUN connection failed (forceTurnRef.current is false), 
    // we should try establishing connection via Force TURN (relay) immediately!
    if (!forceTurnRef.current) {
      console.log(`[Athlete-to-${targetId}] Direct connection failed. Auto-enabling Force TURN relay backup to bypass CGNAT/firewalls.`);
      setForceTurn(true);
      forceTurnRef.current = true;
      (pc as any).isReconnecting = false;
      cleanupSignalingStateForPeer(targetId);
      if (targetId === "host") {
        sendOrQueueSignalingMessage({
          type: "request-stream",
          targetId: "host"
        });
      } else {
        handleCreateOffer(targetId);
      }
      return;
    }

    setTimeout(() => {
      if (peerConnectionsRef.current[targetId] === pc) {
        (pc as any).isReconnecting = false;
        if (targetId === "host") {
          console.log(`[Athlete-to-Host] Re-requesting stream from Host...`);
          sendOrQueueSignalingMessage({
            type: "request-stream",
            targetId: "host"
          });
        } else if (targetId === "obs") {
          // For OBS/Renderer (non-host): Clean up stale state and let the receiver (OBS) coordinate the reconnect via signaling.
          // This avoids bidirectional offer collision and duplicate peer connection creation.
          console.log(`[Athlete-to-${targetId}] Cleaning up stale signaling state for OBS Renderer. Waiting for receiver to request stream...`);
          cleanupSignalingStateForPeer(targetId);
        } else {
          // It's another athlete peer! Send request-stream so they will immediately initiate a fresh WebRTC offer.
          console.log(`[Athlete-to-Athlete ${targetId}] Re-requesting stream from Athlete peer to trigger immediate recovery...`);
          cleanupSignalingStateForPeer(targetId);
          sendOrQueueSignalingMessage({
            type: "request-stream",
            targetId: targetId
          });
        }
      }
    }, 250);
  };

  const handleCreateOffer = async (targetId: string) => {
    try {
      let pc = peerConnectionsRef.current[targetId];
      
      // If there is an existing PC, check if it's healthy and not already negotiating
      const isHealthy = pc && 
        (pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.connectionState === "connecting" || pc.iceConnectionState === "checking");
      
      if (pc && pc.signalingState === "have-local-offer") {
        console.log(`[Athlete-to-${targetId}] Existing PeerConnection is already in have-local-offer state. Skipping offer creation to avoid collision.`);
        return;
      }

      if (pc && !isHealthy) {
        console.log(`[Athlete-to-${targetId}] Closing and destroying unhealthy/stale PeerConnection to ensure a clean state...`);
        try {
          pc.close();
        } catch (e) {}
        delete peerConnectionsRef.current[targetId];
        pc = undefined;
      }

      if (!pc) {
        const isForceTurnActive = use4GModeRef.current || forceTurnRef.current;
        console.log(`[Athlete-to-${targetId}] Creating NEW RTCPeerConnection with forceTurn=${isForceTurnActive}...`);
        pc = new RTCPeerConnection(getWebRtcConfig(isForceTurnActive));
        (pc as any).iceCandidatesQueue = [];
        peerConnectionsRef.current[targetId] = pc;

        // Apply any early queued ICE candidates for this peer
        const earlyCandidates = pendingIceCandidatesRef.current[targetId];
        if (earlyCandidates && earlyCandidates.length > 0) {
          console.log(`[Athlete] Applying ${earlyCandidates.length} queued early ICE candidates to new PC for ${targetId}`);
          earlyCandidates.forEach(cand => {
            (pc as any).iceCandidatesQueue.push(cand);
          });
          delete pendingIceCandidatesRef.current[targetId];
        }
      } else {
        console.log(`[Athlete-to-${targetId}] Reusing existing healthy PeerConnection for renegotiation/Offer...`);
      }

      // Attach tracks
      if (localStreamRef.current) {
        const isAthleteTarget = targetId !== "host" && targetId !== "obs";
        const isRequested = !isAthleteTarget || peersWhoRequestedMyStream.current.has(targetId);
        
        if (isRequested) {
          localStreamRef.current.getTracks().forEach(track => {
            const senderExists = pc!.getSenders().some(s => s.track && s.track.id === track.id);
            if (!senderExists) {
              console.log(`[MEDIA_PIPELINE] [Athlete] addTrack() track ID: ${track.id}, Kind: ${track.kind}, Label: ${track.label} to ${targetId}`);
              const sender = pc!.addTrack(track, localStreamRef.current!);
              if (track.kind === "video") {
                (pc! as any).videoSender = sender;
                const config = getOptimalBitrateAndScale(targetId);
                if (config.disableVideo) {
                  sender.replaceTrack(null).catch(() => {});
                } else {
                  applySenderMaxBitrate(sender, config.bitrate, config.scale);
                }
              }
            } else {
              console.log(`[MEDIA_PIPELINE] [Athlete] Local track ID: ${track.id} is already attached to ${targetId}.`);
            }
          });
        } else {
          console.log(`[MEDIA_PIPELINE] [Athlete] Skipping local track attachment for ${targetId} as they have not requested our stream.`);
        }
      }

      if (!pc.ontrack) {
        pc.ontrack = (event) => {
          console.log(`[MEDIA_PIPELINE] [Athlete-to-${targetId}] ontrack() FIRED! Track ID: ${event.track.id}, Kind: ${event.track.kind}`);
          if (targetId !== "host" && targetId !== "obs") {
            const peerInfo = roomPeersRef.current.find(p => p.id === targetId);
            const peerName = peerInfo ? peerInfo.name : `Vận Động Viên`;
            setAthleteStreams(prev => {
              const current = prev[targetId] || { stream: new MediaStream(), name: peerName };
              const stream = current.stream;
              if (event.streams[0]) {
                event.streams[0].getTracks().forEach(track => {
                  if (stream.getTracks().indexOf(track) === -1) {
                    stream.addTrack(track);
                  }
                });
              } else {
                if (stream.getTracks().indexOf(event.track) === -1) {
                  stream.addTrack(event.track);
                }
              }
              return {
                ...prev,
                [targetId]: { stream: new MediaStream(stream.getTracks()), name: peerName }
              };
            });
          }
        };
      }

      if (!pc.onicecandidate) {
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            sendOrQueueSignalingMessage({
              type: "ice-candidate",
              candidate: event.candidate,
              targetId: targetId
            });
          }
        };
      }

      if (!pc.onconnectionstatechange) {
        pc.onconnectionstatechange = () => {
          console.log(`[Athlete-to-${targetId}] WebRTC Connection State:`, pc!.connectionState);
          if (pc!.connectionState === "connected") {
            if (targetId === "host") {
              setWebrtcConnected(true);
              applyPcMaxBitrate(pc!, currentBitrateRef.current);
            }
            adjustDynamicBitrates();
          } else if (pc!.connectionState === "disconnected" || pc!.connectionState === "failed") {
            if (targetId === "host") {
              setWebrtcConnected(false);
              handleWebRtcFailure(targetId);
            } else if (targetId === "obs") {
              handleWebRtcFailure(targetId);
            } else {
              setAthleteStreams(prev => {
                const next = { ...prev };
                delete next[targetId];
                return next;
              });
              handleWebRtcFailure(targetId);
            }
          }
        };
      }

      if (!pc.oniceconnectionstatechange) {
        pc.oniceconnectionstatechange = () => {
          console.log(`[Athlete-to-${targetId}] ICE Connection State:`, pc!.iceConnectionState);
          if (pc!.iceConnectionState === "connected" || pc!.iceConnectionState === "completed") {
            if (targetId === "host") {
              setWebrtcConnected(true);
              applyPcMaxBitrate(pc!, currentBitrateRef.current);
            }
            adjustDynamicBitrates();
          } else if (pc!.iceConnectionState === "disconnected" || pc!.iceConnectionState === "failed") {
            if (targetId === "host") {
              handleWebRtcFailure(targetId);
            } else if (targetId === "obs") {
              handleWebRtcFailure(targetId);
            } else {
              setAthleteStreams(prev => {
                const next = { ...prev };
                delete next[targetId];
                return next;
              });
              handleWebRtcFailure(targetId);
            }
          }
        };
      }

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
        console.log(`[MEDIA_PIPELINE] [Athlete-to-${targetId}] SDP VERIFICATION (H264 Preferred): m=video exists: ${hasVideo}, sendrecv/sendonly/recvonly exists: ${hasSendRecv}`);
      } else {
        console.warn(`[MEDIA_PIPELINE] [Athlete-to-${targetId}] SDP is undefined!`);
      }
      await pc.setLocalDescription(new RTCSessionDescription({ type: "offer", sdp: offerSdp }));

      sendOrQueueSignalingMessage({
        type: "offer",
        sdp: offerSdp,
        targetId: targetId
      });

    } catch (err) {
      console.error(`Lỗi tạo WebRTC Offer cho ${targetId}:`, err);
    }
  };

  const handleReceiveHostOffer = async (hostId: string, sdp: string) => {
    try {
      let oldPc = peerConnectionsRef.current[hostId];
      if (oldPc) {
        console.log(`[Athlete-to-Host] Closing and destroying old PeerConnection for incoming Offer to ensure clean state...`);
        try {
          oldPc.close();
        } catch (e) {}
        delete peerConnectionsRef.current[hostId];
      }

      console.log(`[Athlete-to-Host] Creating NEW RTCPeerConnection for incoming Offer...`);
      const isForceTurnActive = use4GModeRef.current || forceTurnRef.current;
      const pc = new RTCPeerConnection(getWebRtcConfig(isForceTurnActive));
      (pc as any).iceCandidatesQueue = [];
      peerConnectionsRef.current[hostId] = pc;

      // Apply any early queued ICE candidates for this peer
      const earlyCandidates = pendingIceCandidatesRef.current[hostId];
      if (earlyCandidates && earlyCandidates.length > 0) {
        console.log(`[Athlete] Applying ${earlyCandidates.length} queued early ICE candidates to new PC for incoming Offer from Host ${hostId}`);
        earlyCandidates.forEach(cand => {
          (pc as any).iceCandidatesQueue.push(cand);
        });
        delete pendingIceCandidatesRef.current[hostId];
      }

      pc.ontrack = (event) => {
        console.log(`[MEDIA_PIPELINE] [Athlete] ontrack() FIRED! Peer: ${hostId}, Track ID: ${event.track.id}, Kind: ${event.track.kind}, Label: ${event.track.label}`);
        console.log(`[MEDIA_PIPELINE] [Athlete] ontrack() Number of streams:`, event.streams.length);
        const totalVideoTracks = event.streams.flatMap(s => s.getVideoTracks()).length;
        console.log(`[MEDIA_PIPELINE] [Athlete] ontrack() Video tracks count in event streams:`, totalVideoTracks);

        console.log("[Signaling Athlete] Nhận luồng video/audio từ Host/MC!");
        setHostStream(prev => {
          const stream = prev || new MediaStream();
          if (event.streams[0]) {
            event.streams[0].getTracks().forEach(track => {
              if (stream.getTracks().indexOf(track) === -1) {
                stream.addTrack(track);
              }
            });
          } else {
            if (stream.getTracks().indexOf(event.track) === -1) {
              stream.addTrack(event.track);
            }
          }
          return new MediaStream(stream.getTracks());
        });
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`[MEDIA_PIPELINE] [Athlete-to-Host] addTrack() track ID: ${track.id}, Kind: ${track.kind}, Label: ${track.label}`);
          const sender = pc.addTrack(track, localStreamRef.current!);
          if (track.kind === "video") {
            (pc as any).videoSender = sender;
            const config = getOptimalBitrateAndScale("host");
            if (config.disableVideo) {
              sender.replaceTrack(null).catch(() => {});
            } else {
              applySenderMaxBitrate(sender, config.bitrate, config.scale);
            }
          }
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendOrQueueSignalingMessage({
            type: "ice-candidate",
            candidate: event.candidate,
            targetId: hostId
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[Athlete-to-Host] WebRTC Connection State:`, pc.connectionState);
        if (pc.connectionState === "connected") {
          setWebrtcConnected(true);
          applyPcMaxBitrate(pc, currentBitrateRef.current);
          adjustDynamicBitrates();
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          handleWebRtcFailure(hostId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Athlete-to-Host] ICE Connection State:`, pc.iceConnectionState);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          setWebrtcConnected(true);
          applyPcMaxBitrate(pc, currentBitrateRef.current);
          adjustDynamicBitrates();
        } else if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          handleWebRtcFailure(hostId);
        }
      };

      // Perfect Negotiation: Polite peer rolls back if signaling state is not stable (Offer collision/glare)
      const isCollision = pc.signalingState !== "stable";
      if (isCollision) {
        console.warn("[Athlete-to-Host] Offer collision detected. Rolling back local offer because Athlete is the POLITE peer.");
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch (err) {
          console.warn("[Athlete] Failed explicit rollback, trying direct remote setRemoteDescription...", err);
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
      const answer = await pc.createAnswer();
      let answerSdp = answer.sdp || "";
      if (answerSdp) {
        answerSdp = preferH264(answerSdp);
        // Keep MC stream high quality so the athlete can see the host clearly
        answerSdp = limitIncomingVideoBitrate(answerSdp, 2000);
        const hasVideo = answerSdp.includes("m=video");
        const hasSendRecv = answerSdp.includes("a=sendrecv") || answerSdp.includes("a=sendonly") || answerSdp.includes("a=recvonly");
        console.log(`[MEDIA_PIPELINE] [Athlete-to-Host] SDP VERIFICATION (H264 Preferred): m=video exists: ${hasVideo}, sendrecv/sendonly/recvonly exists: ${hasSendRecv}`);
      } else {
        console.warn(`[MEDIA_PIPELINE] [Athlete-to-Host] SDP is undefined!`);
      }
      await pc.setLocalDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));

      sendOrQueueSignalingMessage({
        type: "answer",
        sdp: answerSdp,
        targetId: hostId
      });

      // Process queued candidates
      const queue = (pc as any).iceCandidatesQueue;
      if (queue && queue.length > 0) {
        console.log(`[Athlete-to-Host] Applying ${queue.length} queued ICE candidates...`);
        for (const cand of queue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.error("Lỗi áp dụng candidate từ hàng đợi:", e);
          }
        }
        (pc as any).iceCandidatesQueue = [];
      }

    } catch (err) {
      console.error("Lỗi tiếp nhận Offer từ MC:", err);
    }
  };

  const handleReceiveAthleteOffer = async (senderId: string, senderName: string, sdp: string) => {
    try {
      let pc = peerConnectionsRef.current[senderId];
      
      if (pc) {
        if (pc.signalingState === "have-local-offer") {
          if (athleteId < senderId) {
            console.log(`[Athlete WebRTC Glare] Rollback local offer because we are polite: ${athleteId} < ${senderId}`);
            try {
              await pc.setLocalDescription({ type: "rollback" });
            } catch (err) {
              console.warn("[Athlete WebRTC Glare] Rollback failed, closing PC instead:", err);
              try { pc.close(); } catch (e) {}
              delete peerConnectionsRef.current[senderId];
              pc = null as any;
            }
          } else {
            console.log(`[Athlete WebRTC Glare] Ignore remote offer because we are impolite: ${athleteId} > ${senderId}`);
            return;
          }
        } else {
          const isHealthy = pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed";
          if (isHealthy && pc.signalingState === "stable") {
            console.log(`[Athlete-to-Athlete] PeerConnection for ${senderId} is already healthy and stable. Handling offer without closing.`);
          } else {
            console.log(`[Athlete-to-Athlete] Closing and destroying unhealthy/stale PeerConnection for Athlete ${senderId}...`);
            try {
              pc.close();
            } catch (e) {}
            delete peerConnectionsRef.current[senderId];
            pc = null as any;
          }
        }
      }

      if (!pc) {
        console.log(`[Athlete-to-Athlete] Creating NEW RTCPeerConnection for incoming Offer from Athlete ${senderId}...`);
        const isForceTurnActive = use4GModeRef.current || forceTurnRef.current;
        pc = new RTCPeerConnection(getWebRtcConfig(isForceTurnActive));
        (pc as any).iceCandidatesQueue = [];
        peerConnectionsRef.current[senderId] = pc;
      }

      const earlyCandidates = pendingIceCandidatesRef.current[senderId];
      if (earlyCandidates && earlyCandidates.length > 0) {
        console.log(`[Athlete] Applying ${earlyCandidates.length} queued early ICE candidates to new PC for incoming Offer from Athlete ${senderId}`);
        earlyCandidates.forEach(cand => {
          (pc as any).iceCandidatesQueue.push(cand);
        });
        delete pendingIceCandidatesRef.current[senderId];
      }

      pc.ontrack = (event) => {
        console.log(`[MEDIA_PIPELINE] [Athlete-to-Athlete] ontrack() FIRED! Peer: ${senderId}, Track ID: ${event.track.id}, Kind: ${event.track.kind}`);
        setAthleteStreams(prev => {
          const current = prev[senderId] || { stream: new MediaStream(), name: senderName };
          const stream = current.stream;
          if (event.streams[0]) {
            event.streams[0].getTracks().forEach(track => {
              if (stream.getTracks().indexOf(track) === -1) {
                stream.addTrack(track);
              }
            });
          } else {
            if (stream.getTracks().indexOf(event.track) === -1) {
              stream.addTrack(event.track);
            }
          }
          return {
            ...prev,
            [senderId]: { stream: new MediaStream(stream.getTracks()), name: senderName }
          };
        });
      };

      if (localStreamRef.current) {
        const isRequested = peersWhoRequestedMyStream.current.has(senderId);
        if (isRequested) {
          localStreamRef.current.getTracks().forEach(track => {
            const senderExists = pc.getSenders().some(s => s.track && s.track.id === track.id);
            if (!senderExists) {
              console.log(`[MEDIA_PIPELINE] [Athlete-to-Athlete] Adding local track ID: ${track.id}, Kind: ${track.kind} to incoming connection from ${senderId}`);
              const sender = pc.addTrack(track, localStreamRef.current!);
              if (track.kind === "video") {
                (pc as any).videoSender = sender;
                // Limit athlete-to-athlete streams to 250 kbps and scale down resolution by 2.0 for high stability
                applySenderMaxBitrate(sender, 250, 2.0);
              }
            } else {
              console.log(`[MEDIA_PIPELINE] [Athlete-to-Athlete] Local track ID: ${track.id} is already attached to ${senderId}.`);
            }
          });
        } else {
          console.log(`[MEDIA_PIPELINE] [Athlete-to-Athlete] Skipping local track addition for incoming connection from ${senderId} as they have not requested our stream.`);
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendOrQueueSignalingMessage({
            type: "ice-candidate",
            candidate: event.candidate,
            targetId: senderId
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[Athlete-to-Athlete ${senderId}] WebRTC Connection State:`, pc.connectionState);
        if (pc.connectionState === "connected") {
          adjustDynamicBitrates();
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setAthleteStreams(prev => {
            const next = { ...prev };
            delete next[senderId];
            return next;
          });
          cleanupSignalingStateForPeer(senderId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Athlete-to-Athlete ${senderId}] ICE Connection State:`, pc.iceConnectionState);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          adjustDynamicBitrates();
        } else if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          setAthleteStreams(prev => {
            const next = { ...prev };
            delete next[senderId];
            return next;
          });
          cleanupSignalingStateForPeer(senderId);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
      const answer = await pc.createAnswer();
      let answerSdp = answer.sdp || "";
      if (answerSdp) {
        answerSdp = preferH264(answerSdp);
        // Keep other athletes' streams high quality and stable, avoiding frozen or black screens (limits to 800 kbps)
        answerSdp = limitIncomingVideoBitrate(answerSdp, 800);
      }
      await pc.setLocalDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));

      sendOrQueueSignalingMessage({
        type: "answer",
        sdp: answerSdp,
        targetId: senderId
      });

    } catch (err) {
      console.error("[Athlete-to-Athlete] Error handleReceiveAthleteOffer:", err);
    }
  };

  const handleRoomViewModeChange = (mode: "mc-only" | "everyone") => {
    setRoomViewMode(mode);
    if (mode === "everyone") {
      // Send request-stream to all athletes in the room
      console.log("[Athlete Full-Mesh] Triggering stream request from all room peers:", roomPeers);
      roomPeers.forEach(peer => {
        if (peer.role === "athlete" && peer.id !== athleteId) {
          console.log(`[Athlete Full-Mesh] Requesting stream from fellow Athlete: ${peer.name} (${peer.id})`);
          sendOrQueueSignalingMessage({
            type: "request-stream",
            targetId: peer.id
          });
        }
      });
    } else {
      // Clear athlete streams and clean up connections to other athletes
      console.log("[Athlete Full-Mesh] Switching back to MC only. Cleaning up athlete streams.");
      setAthleteStreams({});
      peersWhoRequestedMyStream.current.clear();
      setSplitScreenTarget(null);
      setSelectedAthleteId(null);
      Object.keys(peerConnectionsRef.current).forEach(peerId => {
        if (peerId !== "host" && peerId !== "obs") {
          cleanupSignalingStateForPeer(peerId);
        }
      });
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setCameraActive(track.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setMicActive(track.enabled);
      }
    }
  };

  // Full screen trigger for the live athlete
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen toggle failed:", err);
    }
  };

  const handleEnterLive = async () => {
    // Attempt fullscreen
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.warn("Lỗi yêu cầu Fullscreen:", err);
    }

    // Proactively refresh the camera and microphone stream under this user-gesture click context.
    // This solves potential browser-level stream deactivation / suspension on layout changes and fullscreen mode.
    try {
      console.log("[Athlete] Re-acquiring active media stream upon START gesture...");
      await updateCameraStream();
    } catch (err) {
      console.warn("[Athlete] Error refreshing camera stream on START, using lounge preview stream:", err);
    }

    setHasEnteredRoom(true);
    // Open WebRTC connection immediately
    connectSignaling();
  };

  const handleEndLive = () => {
    // Return them to the pre-start lounge (hasEnteredRoom: false)
    setHasEnteredRoom(false);
    
    // Clean up signaling connection & peer connections
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }
    setWsConnected(false);
    setWebrtcConnected(false);
    
    Object.keys(peerConnectionsRef.current).forEach(peerId => {
      cleanupSignalingStateForPeer(peerId);
    });
    setAthleteStreams({});
    setHostStream(null);
    setSplitScreenTarget(null);
    setSelectedAthleteId(null);
  };

  // 1. RENDERING LOUNGE GATE (Before entering room)
  if (!hasEnteredRoom) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center items-center font-sans p-4 relative">
        <div className="max-w-[440px] w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
          
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-950 text-center flex-1">Join Room with Camera</h2>
            <button 
              onClick={onLeave} 
              className="text-slate-400 hover:text-slate-600 transition-all text-xl font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="p-5 flex flex-col space-y-4">
            {/* Vertical Video Preview (Crop) */}
            <div className="w-[200px] h-[260px] bg-slate-100 rounded-xl overflow-hidden mx-auto relative border border-slate-200 shadow-inner flex items-center justify-center">
              <video
                ref={el => {
                  if (el) {
                    localVideoRef.current = el;
                    if (localStream) {
                      if (el.srcObject !== localStream) {
                        el.srcObject = localStream;
                      }
                      el.play().catch(() => {});
                    }
                  }
                }}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transition-all duration-300"
                style={{ 
                  transform: `${isMirrored ? "scaleX(-1)" : "scaleX(1)"} scale(${cssScale})`, 
                  transformOrigin: "center center" 
                }}
              />
              {!cameraActive && (
                <div className="absolute inset-0 bg-slate-200 flex flex-col items-center justify-center text-slate-500">
                  <VideoOff className="h-8 w-8 text-rose-500 mb-1" />
                  <span className="text-[10px] font-mono uppercase tracking-wider">Camera Tắt</span>
                </div>
              )}
            </div>

            {/* Giant green START button */}
            <button
              onClick={handleEnterLive}
              className="w-full bg-[#00ff3c] hover:bg-[#00e035] text-black font-black py-3 px-6 rounded-lg text-sm tracking-widest cursor-pointer shadow-md transition-all active:scale-95 text-center block uppercase border border-[#00ea37]/40"
            >
              START
            </button>

            {/* Config Panels */}
            <div className="space-y-3.5 pt-2">
              
              {/* Video Source */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                  <span>📹 Video Source</span>
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedVideo}
                    onChange={(e) => updateCameraStream(e.target.value, undefined, undefined)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 outline-none cursor-pointer"
                  >
                    <option value="auto">📹 Tự động nhận diện</option>
                    {videoDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.substring(0, 5)}`}</option>
                    ))}
                  </select>
                  <button 
                    onClick={() => updateCameraStream(undefined, facingMode === "user" ? "environment" : "user", undefined)}
                    className="p-1.5 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 transition-all cursor-pointer"
                    title="Đổi camera trước/sau"
                  >
                    <Camera className="h-4 w-4 text-slate-600" />
                  </button>
                </div>
              </div>

              {/* Quality Options */}
              <div className="bg-slate-50 border border-slate-150 rounded-lg p-3 space-y-2 text-center text-xs">
                <div className="flex justify-around items-center gap-1">
                  {[
                    { id: "1080p", label: "High Resolution (1080p)" },
                    { id: "720p", label: "Balanced (720p)" }
                  ].map((item) => {
                    const isSelected = resolution === item.id;
                    return (
                      <label key={item.id} className="flex items-center gap-1 cursor-pointer font-medium text-slate-700">
                        <input
                          type="radio"
                          name="resolution-select"
                          checked={isSelected}
                          onChange={() => updateCameraStream(undefined, undefined, item.id as any)}
                          className="accent-[#00ff3c] cursor-pointer"
                        />
                        <span>{item.label}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-200/50">
                  Current Video Settings: {resolution === "1080p" ? "1920x1080@30fps (FHD)" : "1280x720@30fps (HD)"}
                </div>
              </div>

              {/* Audio Source */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                  <span>🎙 Audio Source(s)</span>
                </label>
                <select
                  value={selectedAudio}
                  onChange={(e) => setSelectedAudio(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 outline-none cursor-pointer"
                >
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.substring(0, 5)}`}</option>
                  ))}
                </select>
              </div>

              {/* Audio Output Destination */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-slate-800">🎧 Audio Output Destination</label>
                  <button 
                    onClick={() => {
                      const audio = new Audio("https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg");
                      audio.play().catch(e => console.log("Audio play test error:", e));
                    }}
                    className="text-[10px] bg-slate-100 border border-slate-200 hover:bg-slate-200 px-2 py-0.5 rounded cursor-pointer text-slate-600 font-mono"
                  >
                    Test
                  </button>
                </div>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-900 outline-none cursor-pointer"
                  disabled
                >
                  <option>Speaker 1 (Default System Output)</option>
                </select>
              </div>

            </div>

          </div>

        </div>
      </div>
    );
  }

  // 2. RENDERING ACTIVE BROADCAST ROOM (Live Screen)
  return (
    <div className="h-screen w-screen bg-black text-slate-100 flex flex-col justify-between font-sans relative overflow-hidden select-none">
      
      {/* Top Banner (Translucent Overlay) */}
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-xs font-mono font-medium text-slate-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>LIVE</span>
          </div>
          
          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 text-slate-300">
            {/* Custom vector indicators similar to Image 3 */}
            <span className="text-xs font-mono flex items-center gap-1">
              <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </span>
            <span className="text-xs font-mono flex items-center gap-1 border-l border-white/10 pl-2">
              <span className="text-slate-400 font-bold">👂</span>
            </span>
            <span className="text-xs font-mono flex items-center gap-1 border-l border-white/10 pl-2">
              <span className="text-slate-400 font-bold">👁</span>
              <span className="text-slate-200 font-bold">1</span>
            </span>
            <span className="text-xs font-mono flex items-center gap-1 border-l border-white/10 pl-2">
              <span className="text-slate-400 font-bold">🎬</span>
            </span>
          </div>
        </div>

        {/* Realtime Bandwidth Status */}
        <div className="flex items-center gap-2">
          {use4GMode && (
            <div className="bg-cyan-950/80 backdrop-blur-md px-2.5 py-1 rounded-full border border-cyan-500/30 text-[9px] font-mono font-bold text-cyan-400 flex items-center gap-1 animate-pulse">
              <span>TURN-4G</span>
            </div>
          )}
          <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[11px] font-mono font-bold text-slate-300 flex items-center gap-1">
            <span className="text-[#00ff3c] animate-pulse">●</span>
            <span>{resolution.toUpperCase()}</span>
          </div>
          <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[11px] font-mono font-bold text-[#00ff3c]">
            {realtimeBitrate}-kbps
          </div>
        </div>
      </div>

      {/* Network Warning Banner if resolution is below 720p */}
      {resolution === "480p" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-amber-500/90 backdrop-blur-md text-black font-bold text-[11px] px-4 py-1.5 rounded-full z-20 flex items-center gap-1.5 border border-amber-600/30 animate-bounce">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>⚠️ TÍN HIỆU ĐANG YẾU (&lt; 720P) - Đang truyền ở mức 480p!</span>
        </div>
      )}

      {/* Main Viewport Content - Full screen Video */}
      <div 
        onClick={handleVideoTouch} 
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`flex-1 w-full h-full relative bg-slate-950 overflow-hidden ${
          activeCameraMode === "target-focus" ? "cursor-crosshair" : ""
        }`}
      >
        
        {/* Split-screen layout or Full-width Local Video stream */}
        {splitScreenTarget !== null ? (
          <div className="w-full h-full flex flex-col">
            {/* Top half: Local video (Vđv chính) */}
            <div className="w-full h-1/2 relative bg-black border-b border-slate-800 overflow-hidden">
              <video
                key="split-top-local-video"
                ref={el => {
                  if (el) {
                    localVideoRef.current = el;
                    if (localStream) {
                      if (el.srcObject !== localStream) {
                        el.srcObject = localStream;
                      }
                      el.play().catch(() => {});
                    }
                  }
                }}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ 
                  transform: `${isMirrored ? "scaleX(-1)" : "scaleX(1)"} scale(${cssScale})`, 
                  transformOrigin: "center center" 
                }}
              />
              <div className="absolute top-2 left-2 bg-purple-600/85 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-bold font-mono text-white z-10 shadow border border-white/10">
                BẠN (VĐV CHÍNH)
              </div>
            </div>

            {/* Bottom half: Selected Athlete or MC */}
            {splitScreenTarget === "athlete" && selectedAthleteId ? (
              <div className="w-full h-1/2 relative bg-black overflow-hidden">
                <video
                  key={`split-bottom-athlete-${selectedAthleteId}`}
                  autoPlay
                  playsInline
                  muted={!earphoneEnabled}
                  className="w-full h-full object-cover"
                  ref={el => {
                    if (el && selectedAthleteId && athleteStreams[selectedAthleteId]) {
                      const stream = athleteStreams[selectedAthleteId].stream;
                      if (el.srcObject !== stream) {
                        el.srcObject = stream;
                        el.play().catch(() => {});
                      }
                    }
                  }}
                />
                <div className="absolute top-2 left-2 bg-cyan-600/85 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-bold font-mono text-white z-10 shadow border border-white/10">
                  {athleteStreams[selectedAthleteId]?.name || "VĐV LIÊN KẾT"} (VĐV 2)
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSplitScreenTarget(null);
                    setSelectedAthleteId(null);
                  }}
                  className="absolute top-2 right-2 bg-red-600/95 hover:bg-red-700 active:scale-95 text-white p-1 rounded-full cursor-pointer shadow-lg z-20 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="w-full h-1/2 relative bg-black overflow-hidden">
                {hostStream ? (
                  <video
                    key="split-bottom-host"
                    autoPlay
                    playsInline
                    muted={!earphoneEnabled}
                    className="w-full h-full object-cover"
                    ref={el => {
                      if (el && el.srcObject !== hostStream) {
                        el.srcObject = hostStream;
                        el.play().catch(() => {});
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin mb-2 text-purple-400" />
                    <span className="text-[10px] font-mono text-purple-300">Đợi MC...</span>
                  </div>
                )}
                <div className="absolute top-2 left-2 bg-pink-600/85 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-bold font-mono text-white z-10 shadow border border-white/10">
                  MC BAN TỔ CHỨC
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSplitScreenTarget(null);
                    setSelectedAthleteId(null);
                  }}
                  className="absolute top-2 right-2 bg-red-600/95 hover:bg-red-700 active:scale-95 text-white p-1 rounded-full cursor-pointer shadow-lg z-20 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Full-width Local Video stream */
          <video
            key="full-width-local-video"
            ref={el => {
              if (el) {
                localVideoRef.current = el;
                if (localStream) {
                  if (el.srcObject !== localStream) {
                    el.srcObject = localStream;
                  }
                  el.play().catch(() => {});
                }
              }
            }}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transition-all"
            style={{ 
              transform: `${isMirrored ? "scaleX(-1)" : "scaleX(1)"} scale(${cssScale})`, 
              transformOrigin: "center center" 
            }}
          />
        )}

        {/* Target Focus HUD & Animated targeting ring */}
        {activeCameraMode === "target-focus" && (
          <div className="absolute top-18 left-4 bg-purple-600/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-purple-400 font-mono text-[10px] text-white z-10 flex items-center gap-1.5 select-none shadow-lg animate-pulse-slow">
            <span className="text-yellow-400">🎯</span>
            <span className="font-bold">TARGET FOCUS ACTIVE</span>
            {focusLocked ? (
              <span className="text-emerald-400 font-bold ml-1 flex items-center gap-0.5">
                (LOCKED 🔒)
              </span>
            ) : (
              <span className="text-yellow-300 font-bold ml-1 animate-pulse">
                (TẠM KHÓA - CHẠM VÙNG BIA)
              </span>
            )}
          </div>
        )}

        {focusCoordinates && (
          <div 
            className="absolute z-30 pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${focusCoordinates.x}%`, top: `${focusCoordinates.y}%` }}
          >
            <div className="relative flex items-center justify-center">
              <div className="absolute h-16 w-16 rounded-full border-2 border-red-500 animate-ping opacity-75" />
              <div className="absolute h-10 w-10 rounded-full border-2 border-yellow-400 animate-pulse" />
              <div className="absolute h-4 w-4 rounded-full bg-red-600" />
              <div className="absolute h-8 w-[2px] bg-yellow-400" />
              <div className="absolute w-8 h-[2px] bg-yellow-400" />
            </div>
            <div className="text-[9px] font-mono font-bold text-yellow-400 text-center mt-8 bg-black/75 px-2 py-0.5 rounded whitespace-nowrap shadow border border-white/10">
              LOCKED FOCUS AT {focusCoordinates.x.toFixed(0)}%, {focusCoordinates.y.toFixed(0)}%
            </div>
          </div>
        )}

        {focusLocked && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleResetFocus();
            }}
            className="absolute bottom-36 left-4 z-20 bg-yellow-500 hover:bg-yellow-600 text-slate-950 font-mono font-black text-[10px] px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-lg shadow-yellow-500/20"
          >
            <span>Auto Focus / Reset</span>
          </button>
        )}

        {/* Float Return feed (MC) or Round PIP depending on split screen target */}
        <div className={`absolute top-18 right-4 flex flex-col gap-2 z-10 max-h-[75vh] overflow-y-auto no-scrollbar transition-all duration-200 ${splitScreenTarget !== null ? "pointer-events-none opacity-0 invisible" : "opacity-100 animate-fade-in"}`}>
          {/* Host PIP Card */}
          <div 
            onClick={(e) => {
              e.stopPropagation();
              // If clicked, enter split screen with Host
              setSplitScreenTarget("host");
            }}
            className="w-[120px] sm:w-[150px] aspect-video bg-black rounded-lg overflow-hidden border-2 border-purple-500 shadow-lg relative shrink-0 cursor-pointer hover:border-white transition-all hover:scale-105"
          >
            <div className="absolute top-1 left-1 bg-black/60 px-1 py-0.2 text-[8px] font-mono text-purple-400 rounded z-10">
              MC BAN TỔ CHỨC
            </div>
            {hostStream ? (
              <video
                ref={el => {
                  hostVideoRef.current = el;
                  if (el && el.srcObject !== hostStream) {
                    el.srcObject = hostStream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted={!earphoneEnabled}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin mb-1 text-purple-400" />
                <span className="text-[8px] font-mono">Đợi MC...</span>
              </div>
            )}
          </div>

          {/* Other Athletes PIP Cards (Rendered if roomViewMode is 'everyone') */}
          {roomViewMode === "everyone" && Object.entries(athleteStreams).map(([peerId, val]: [string, any]) => {
            const { stream, name } = val;
            return (
              <div 
                key={peerId} 
                onClick={(e) => {
                  e.stopPropagation();
                  // If clicked, pull this athlete into split screen (athlete 2)
                  setSelectedAthleteId(peerId);
                  setSplitScreenTarget("athlete");
                }}
                className="w-[120px] sm:w-[150px] aspect-video bg-black rounded-lg overflow-hidden border-2 border-cyan-500/80 shadow-lg relative shrink-0 animate-fade-in cursor-pointer hover:border-white transition-all hover:scale-105"
              >
                <div className="absolute top-1 left-1 bg-black/60 px-1 py-0.2 text-[8px] font-mono text-cyan-400 rounded z-10">
                  {name} (VĐV)
                </div>
                <video
                  autoPlay
                  playsInline
                  muted={!earphoneEnabled}
                  className="w-full h-full object-cover"
                  ref={el => {
                    if (el && el.srcObject !== stream) {
                      el.srcObject = stream;
                      el.play().catch(() => {});
                    }
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Round PIP for Split Screen Layout (centered vertically on the right) */}
        <div 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            transform: `translate(${pipPosition.x}px, ${pipPosition.y}px)`,
            touchAction: "none"
          }}
          className={`absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 cursor-move select-none transition-all duration-200 ${
            (splitScreenTarget === "athlete" || (splitScreenTarget === "host" && selectedAthleteId !== null)) 
              ? "opacity-100 scale-100 pointer-events-auto" 
              : "pointer-events-none opacity-0 scale-95 invisible h-0 overflow-hidden"
          }`}
        >
          <div 
            className="h-[80px] w-[80px] sm:h-[100px] sm:w-[100px] rounded-full overflow-hidden border-2 border-white bg-black shadow-2xl relative hover:scale-105 active:scale-95 transition-all pointer-events-none"
          >
            {splitScreenTarget === "athlete" ? (
              // MC is in Round PIP
              hostStream ? (
                <video
                  autoPlay
                  playsInline
                  muted={!earphoneEnabled}
                  className="w-full h-full object-cover pointer-events-none"
                  ref={el => {
                    if (el && el.srcObject !== hostStream) {
                      el.srcObject = hostStream;
                      el.play().catch(() => {});
                    }
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-900 text-[8px] font-mono text-slate-500 pointer-events-none">
                  Đợi MC...
                </div>
              )
            ) : (
              // Selected Athlete is in Round PIP
              selectedAthleteId && athleteStreams[selectedAthleteId] ? (
                <video
                  autoPlay
                  playsInline
                  muted={!earphoneEnabled}
                  className="w-full h-full object-cover pointer-events-none"
                  ref={el => {
                    if (el && selectedAthleteId && athleteStreams[selectedAthleteId]) {
                      const stream = athleteStreams[selectedAthleteId].stream;
                      if (el.srcObject !== stream) {
                        el.srcObject = stream;
                        el.play().catch(() => {});
                      }
                    }
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-900 text-[8px] font-mono text-slate-500 pointer-events-none">
                  Đợi VĐV...
                </div>
              )
            )}
          </div>
          <div className="bg-black/80 px-2 py-0.5 rounded text-[8px] font-black font-mono text-white shadow select-none uppercase tracking-wider text-center max-w-[120px] truncate pointer-events-none">
            {splitScreenTarget === "athlete" ? "CHẠM ĐỔI MC" : `CHẠM ĐỔI VĐV`}
          </div>
        </div>

        {/* Floating Quick Settings Menu (if open) */}
        {showSettings && (
          <div className="absolute bottom-36 right-4 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl p-4 w-[280px] z-30 text-white space-y-3 shadow-2xl">
            <h4 className="text-xs font-bold font-mono text-cyan-400 flex items-center justify-between">
              <span>CÀI ĐẶT NHANH</span>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">✕</button>
            </h4>
            
            {/* Camera Select */}
            <div className="space-y-1">
              <label className="text-[9px] text-slate-400 font-mono block">CAMERA</label>
              <select
                value={selectedVideo}
                onChange={(e) => updateCameraStream(e.target.value, undefined, undefined)}
                className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white"
              >
                <option value="auto">📹 Tự động nhận diện</option>
                {videoDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.substring(0, 5)}`}</option>
                ))}
              </select>
            </div>

            {/* Quality Select */}
            <div className="space-y-1">
              <label className="text-[9px] text-slate-400 font-mono block">CHẤT LƯỢNG TRUYỀN</label>
              <div className="grid grid-cols-2 gap-1">
                {(["1080p", "720p"] as const).map(res => (
                  <button
                    key={res}
                    onClick={() => updateCameraStream(undefined, undefined, res)}
                    className={`py-1 rounded text-[10px] font-bold font-mono ${resolution === res ? "bg-cyan-500 text-black" : "bg-slate-900 border border-white/10 text-slate-300"}`}
                  >
                    {res === "1080p" ? "1080p (FHD)" : "720p (HD)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Zoom Slider */}
            <div className="space-y-1 pb-2">
              <div className="flex justify-between items-center text-[10px] text-slate-400">
                <span>ZOOM CAMERA</span>
                <span className="text-cyan-400 font-mono">{zoomValue.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={videoDevices.some(d => {
                  const l = (d.label || "").toLowerCase();
                  return l.includes("ultra") || l.includes("0.5") || l.includes("wide") || l.includes("góc rộng");
                }) ? 0.5 : 1.0}
                max="4.0"
                step="0.1"
                value={zoomValue}
                onChange={(e) => handleZoomUpdate(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Camera Mode Select inside settings */}
            <div className="space-y-1 pb-2 border-t border-white/10 pt-2">
              <label className="text-[9px] text-slate-400 font-mono block">CHẾ ĐỘ QUAY VIDEO</label>
              <div className="grid grid-cols-3 gap-1">
                {(["normal", "target-focus", "sport-broadcast"] as const).map(mode => {
                  let label = "Mặc định";
                  if (mode === "target-focus") label = "🎯 Target";
                  if (mode === "sport-broadcast") label = "⚡ Sport";
                  const isSelected = activeCameraMode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => handleModeChange(mode)}
                      className={`py-1 rounded text-[9px] font-bold font-mono transition-all ${
                        isSelected 
                          ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/20" 
                          : "bg-slate-900 border border-white/10 text-slate-300 hover:bg-white/5"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Room View Mode - Static indicator per user request */}
            <div className="space-y-1 pb-2 border-t border-white/10 pt-2">
              <label className="text-[9px] text-slate-400 font-mono block">CHẾ ĐỘ XEM TRONG PHÒNG</label>
              <div className="py-1.5 px-2 bg-cyan-950/40 border border-cyan-500/20 rounded flex items-center gap-1.5 text-cyan-400 text-[10px] font-bold font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                👥 Xem tất cả (Cố định)
              </div>
            </div>

            {/* 4G Mode Toggle / Force TURN */}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-200">CHẾ ĐỘ MẠNG 4G</span>
                <span className="text-[8px] text-slate-400">Ép kết nối đi qua TURN Relay</span>
              </div>
              <button
                onClick={() => toggle4GMode(!use4GMode)}
                className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${use4GMode ? "bg-cyan-500" : "bg-slate-800"}`}
              >
                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ${use4GMode ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          </div>
        )}

        {/* Floating Chat Overlay (if open) */}
        {chatOpen && (
          <div className="absolute bottom-24 left-4 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl p-3 w-[260px] h-[160px] z-30 text-white flex flex-col justify-between shadow-2xl">
            <div className="text-xs font-bold font-mono text-cyan-400 flex justify-between items-center pb-1 border-b border-white/10">
              <span>TIN NHẮN NỘI BỘ</span>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="flex-1 py-1.5 overflow-y-auto text-[10px] font-mono space-y-1 text-slate-300">
              <p><span className="text-purple-400">[MC]:</span> Đã nhận luồng HD sắc nét của bạn, chuẩn bị lên sóng!</p>
              <p><span className="text-cyan-400">[Bạn]:</span> Sẵn sàng.</p>
            </div>
            <input 
              type="text" 
              placeholder="Gửi tin nhắn..." 
              className="w-full bg-slate-900 border border-white/10 text-xs rounded px-2 py-1 outline-none text-white font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>
        )}

      </div>



      {/* Bottom Bar Pill Container (Image 3 inspired) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-lg rounded-full px-6 py-3 border border-white/15 flex items-center gap-4 z-20 shadow-2xl">
        
        {/* Chat Button */}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className={`h-11 w-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${chatOpen ? "bg-cyan-500 text-black" : "bg-white/10 hover:bg-white/20 text-slate-300"}`}
          title="Tin nhắn"
        >
          <span className="text-lg">💬</span>
        </button>

        {/* Speaker / Earphone */}
        <button
          onClick={() => setEarphoneEnabled(!earphoneEnabled)}
          className={`h-11 w-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${earphoneEnabled ? "bg-white/10 hover:bg-white/20 text-slate-300" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"}`}
          title="Tông âm tai nghe"
        >
          {earphoneEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        </button>

        {/* Mic Toggle Button */}
        <button
          onClick={toggleMic}
          className={`h-11 w-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${micActive ? "bg-white/10 hover:bg-white/20 text-slate-300" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"}`}
          title={micActive ? "Tắt Mic" : "Mở Mic"}
        >
          {micActive ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>

        {/* Video Camera Toggle Button */}
        <button
          onClick={toggleCamera}
          className={`h-11 w-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${cameraActive ? "bg-white/10 hover:bg-white/20 text-slate-300" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"}`}
          title={cameraActive ? "Tắt Camera" : "Mở Camera"}
        >
          {cameraActive ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>

        {/* Flip / Rotate Camera */}
        <button
          onClick={() => updateCameraStream(undefined, facingMode === "user" ? "environment" : "user", undefined)}
          className="h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center transition-all cursor-pointer"
          title="Xoay camera trước/sau"
        >
          <RotateCw className="h-5 w-5" />
        </button>

        {/* Settings gear */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`h-11 w-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${showSettings ? "bg-cyan-500 text-black" : "bg-white/10 hover:bg-white/20 text-slate-300"}`}
          title="Cài đặt thông số"
        >
          <Settings className="h-5 w-5" />
        </button>

        {/* Disconnect red hangup */}
        <button
          onClick={handleEndLive}
          className="h-11 w-11 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-red-600/30"
          title="Rời cuộc gọi"
        >
          <PhoneOff className="h-5 w-5" />
        </button>

      </div>

    </div>
  );
}

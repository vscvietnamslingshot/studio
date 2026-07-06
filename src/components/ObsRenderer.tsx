import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, Volume2, Trophy, ShieldAlert, Eye, EyeOff, Move, Scissors, Maximize2, Crop } from "lucide-react";
import { StreamSettings } from "../types";
import { ConfettiCanvas } from "./VisualEffects";
const defaultLogo = "https://lh3.googleusercontent.com/d/1CAz9xUSO8XIvtEy9TYqil228Cz-jYcIM";

let cachedEcdsaCertificate: RTCCertificate | null = null;
if (typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && RTCPeerConnection.generateCertificate) {
  RTCPeerConnection.generateCertificate({
    name: "ECDSA",
    namedCurve: "P-256"
  } as any).then(cert => {
    cachedEcdsaCertificate = cert;
    console.log("[WebRTC OBS] ECDSA certificate generated successfully for 4G cellular compatibility.");
  }).catch(err => {
    console.warn("[WebRTC OBS] Failed to pre-generate ECDSA certificate, falling back to default RSA:", err);
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

interface ObsRendererProps {
  roomId: string;
  isPreview?: boolean;
  settings?: StreamSettings;
  onUpdateSettings?: (settings: StreamSettings, isCommit?: boolean) => void;
  localStreams?: Record<string, { id: string; name: string; role: "host" | "athlete" | "obs"; stream?: MediaStream; isMirrored?: boolean }>;
}

interface PeerStreamInfo {
  stream?: MediaStream | null;
  name: string;
  role: "host" | "athlete" | "obs";
  isMirrored?: boolean;
  facingMode?: "user" | "environment";
}

interface ScoreDisplayProps {
  score: number;
  clientId: string;
  className?: string;
}

export function ScoreDisplayWithFireworks({ score, clientId, className = "" }: ScoreDisplayProps) {
  const prevScoreRef = useRef<number>(score);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string; scale: number }[]>([]);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [particleOrigin, setParticleOrigin] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let el = document.getElementById("global-fireworks-portal");
    if (!el) {
      el = document.createElement("div");
      el.id = "global-fireworks-portal";
      el.style.position = "fixed";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      el.style.overflow = "hidden";
      el.style.zIndex = "99999";
      document.body.appendChild(el);
    }
    setPortalContainer(el);
  }, []);

  useEffect(() => {
    if (score > prevScoreRef.current) {
      let originX = window.innerWidth / 2;
      let originY = window.innerHeight / 2;
      
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        originX = rect.left + rect.width / 2;
        originY = rect.top + rect.height / 2;
      }
      setParticleOrigin({ x: originX, y: originY });

      const newParticles = Array.from({ length: 16 }).map((_, i) => {
        const angle = (i * 360) / 16 + (Math.random() * 15 - 7.5);
        const rad = (angle * Math.PI) / 180;
        const velocity = 50 + Math.random() * 50;
        return {
          id: Math.random() + i,
          x: Math.cos(rad) * velocity,
          y: Math.sin(rad) * velocity,
          color: [
            "#f59e0b",
            "#10b981",
            "#3b82f6",
            "#ec4899",
            "#8b5cf6",
            "#ef4444",
            "#22d3ee",
            "#facc15"
          ][Math.floor(Math.random() * 8)],
          scale: 1.2 + Math.random() * 1.6,
        };
      });
      setParticles(newParticles);
      
      const timer = setTimeout(() => {
        setParticles([]);
      }, 1500);
      prevScoreRef.current = score;
      return () => clearTimeout(timer);
    } else {
      prevScoreRef.current = score;
    }
  }, [score, clientId]);

  return (
    <span ref={containerRef} className="relative inline-block select-none">
      <span className={className}>{score}</span>
      {portalContainer && particles.length > 0 && createPortal(
        <>
          {particles.map((p) => (
            <span
              key={p.id}
              className="absolute h-4 w-4 rounded-full pointer-events-none z-[99999] animate-firework-particle"
              style={{
                backgroundColor: p.color,
                left: `${particleOrigin.x}px`,
                top: `${particleOrigin.y}px`,
                transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${p.scale})`,
                "--tx": `${p.x}px`,
                "--ty": `${p.y}px`,
                "--color": p.color,
                boxShadow: `0 0 8px ${p.color}, 0 0 16px ${p.color}`,
              } as React.CSSProperties}
            />
          ))}
        </>,
        portalContainer
      )}
    </span>
  );
}

export function ObsRenderer({ roomId, isPreview = false, settings: propSettings, onUpdateSettings, localStreams }: ObsRendererProps) {
  // Config state (controlled remotely by Host/MC)
  const [localSettings, setLocalSettings] = useState<StreamSettings>(() => {
    try {
      const saved = localStorage.getItem(`obs_settings_${roomId}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return {
      roomId,
      layout: "grid",
      logoUrl: defaultLogo,
      logoPosition: "top-right",
      logoSize: 10,
      bannerText: "BẢN TIN TRỰC TIẾP",
      bannerBgColor: "#ef4444",
      bannerTextColor: "#ffffff",
      tickerText: "Chào mừng quý vị khán giả đang theo dõi luồng phát sóng trực tiếp từ Giải Đấu Thể Thao Kịch Tính...",
      tickerSpeed: 15,
      showTicker: true,
      showBanner: true,
      backgroundStyle: "transparent",
      highlightedClientId: "",
      showScoreboard: false,
      showIndividualScores: false,
      scoreboardTitle: "BẢNG ĐIỂM THI ĐẤU",
      scoreboardEventName: "VÒNG CHUNG KẾT",
      scores: {},
      scoreNames: {},
      showLowerThirds: false,
      lowerThirdText: "Hệ thống truyền hình đám mây thời gian thực",
      aspectRatio: "16:9"
    };
  });

  const [soloPeerId] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("solo") || params.get("soloAthleteId") || null;
    } catch (e) {
      return null;
    }
  });

  const baseSettings = propSettings || localSettings;
  const settings = (() => {
    if (soloPeerId) {
      return {
        ...baseSettings,
        showBanner: false,
        showTicker: false,
        showScoreboard: false,
        showLowerThirds: false,
        logoUrl: "",
        backgroundStyle: "transparent",
        layout: "grid" as const
      };
    }
    return baseSettings;
  })();

  const setSettings = (updated: StreamSettings, isCommit: boolean = true) => {
    if (propSettings) {
      if (onUpdateSettings) {
        onUpdateSettings(updated, isCommit);
      }
    } else {
      setLocalSettings(updated);
      try {
        localStorage.setItem(`obs_settings_${roomId}`, JSON.stringify(updated));
      } catch (e) {}
      if (isCommit && wsRef.current?.readyState === WebSocket.OPEN) {
        sendOrQueueSignalingMessage({
          type: "control-update",
          settings: updated
        });
      }
    }
  };

  const [peerStreams, setPeerStreams] = useState<Record<string, PeerStreamInfo>>({});
  const [showConfetti, setShowConfetti] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [showScoreboardCropMenu, setShowScoreboardCropMenu] = useState(false);
  const [showLogoCropMenu, setShowLogoCropMenu] = useState(false);
  const [showBannerCropMenu, setShowBannerCropMenu] = useState(false);
  const [showTickerCropMenu, setShowTickerCropMenu] = useState(false);
  const [showLowerThirdCropMenu, setShowLowerThirdCropMenu] = useState(false);

  // References
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  
  // Network Handover Recovery Queue
  const pendingMessagesRef = useRef<any[]>([]);

  const sendOrQueueSignalingMessage = (msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(msg));
      } catch (err) {
        console.error("[OBS Renderer] Error sending message, queuing instead:", err);
        pendingMessagesRef.current.push(msg);
      }
    } else {
      console.log("[OBS Renderer] WebSocket not open. Queuing message of type:", msg.type);
      pendingMessagesRef.current.push(msg);
    }
  };
  const pendingIceCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const peerNamesRef = useRef<Record<string, { name: string; role: "host" | "athlete" | "obs" }>>({
    "host": { name: "MC Ban Tổ Chức", role: "host" }
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const obsUniqueIdRef = useRef<string>(`obs_${Math.random().toString(36).substring(2, 9)}`);
  const lastRequestTimeRef = useRef<Record<string, number>>({});
  const lastMessageTimeRef = useRef<number>(Date.now());
  const lastBytesReceivedRef = useRef<Record<string, { bytes: number; timestamp: number }>>({});

  useEffect(() => {
    // If we have local streams passed down, we do NOT need to establish WebRTC/Signaling
    if (!(isPreview && localStreams)) {
      connectSignaling();
    }

    return () => {
      wsRef.current?.close();
      (Object.values(peerConnectionsRef.current) as RTCPeerConnection[]).forEach(pc => pc.close());
    };
  }, [isPreview, localStreams]);

  // Periodic pipeline logger for video state, RTCRtpReceiver stats, and RTCRtpSender stats
  useEffect(() => {
    const logInterval = setInterval(async () => {
      console.log("=== [MEDIA_PIPELINE LOGGER (OBS)] START ===");

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

      console.log("=== [MEDIA_PIPELINE LOGGER (OBS)] END ===");
    }, 4000);

    return () => clearInterval(logInterval);
  }, []);

  // Sync peerStreams with localStreams when provided (directly shares active WebRTC instances)
  useEffect(() => {
    if (isPreview && localStreams) {
      const streamsMap: Record<string, PeerStreamInfo> = {};
      Object.entries(localStreams).forEach(([id, peer]) => {
        if (peer.stream) {
          streamsMap[id] = {
            stream: peer.stream,
            name: peer.name,
            role: peer.role,
            isMirrored: peer.isMirrored
          };
        }
      });
      setPeerStreams(streamsMap);
    }
  }, [isPreview, localStreams]);

  // Proactive WebSocket reconnection guard for wake-from-sleep or mobile tab suspend
  useEffect(() => {
    if (isPreview && localStreams) return;

    const handleSyncReconnect = (e?: Event) => {
      const ws = wsRef.current;
      const now = Date.now();
      const lastMsg = lastMessageTimeRef.current;
      const isOnlineEvent = e && e.type === "online";
      const isZombie = ws && ws.readyState === WebSocket.OPEN && (now - lastMsg > 30000);

      // Force reconnect on actual network interface changes ('online' event)
      // because IP address has changed (e.g. WiFi -> 4G) and TCP socket is 100% dead.
      // Also reconnect if no WebSocket exists, it's CLOSED/CLOSING, or it's a zombie.
      if (isOnlineEvent || !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING || isZombie) {
        console.log(`[OBS Sync] Reconnect triggered (Event: ${e ? e.type : "sync"}, State: ${ws ? ws.readyState : "missing"}, isZombie: ${!!isZombie}). Reconnecting...`);
        connectSignaling();
      }
    };

    const handleOnline = (e: Event) => handleSyncReconnect(e);
    const handleOthers = () => handleSyncReconnect();

    window.addEventListener("visibilitychange", handleOthers);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleOthers);

    return () => {
      window.removeEventListener("visibilitychange", handleOthers);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleOthers);
    };
  }, [isPreview, localStreams]);

  // Bulletproof real-time health check and self-healing loop for all peer streams in OBS
  useEffect(() => {
    if (isPreview && localStreams) return;

    const interval = setInterval(() => {
      // 1. Proactively verify and heal WebSocket connection if dead, zombie, or stuck-connecting
      const ws = wsRef.current;
      const now = Date.now();
      const lastMsg = lastMessageTimeRef.current;
      // Safer threshold of 60 seconds to completely avoid false zombie triggers during latency spikes
      const isZombie = ws && ws.readyState === WebSocket.OPEN && (now - lastMsg > 60000);
      const isStuckConnecting = ws && ws.readyState === WebSocket.CONNECTING && (now - lastMsg > 20000);

      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING || isZombie || isStuckConnecting) {
        console.warn(`[OBS Health Check] WebSocket state is ${ws ? ws.readyState : "missing"} (isZombie: ${isZombie}, isStuckConnecting: ${isStuckConnecting}). Attempting reconnect...`);
        connectSignaling();
        return;
      }

      if (ws.readyState !== WebSocket.OPEN) {
        return; // Wait for socket to become open
      }

      // 2. Scan and heal stale, failed, or zombie WebRTC peer streams
      const activePeerIds = Object.keys(peerNamesRef.current);
      activePeerIds.forEach(async (peerId) => {
        const pc = peerConnectionsRef.current[peerId];
        let isHealthy = pc && (
          pc.connectionState === "connected" || 
          pc.iceConnectionState === "connected" || 
          pc.iceConnectionState === "completed"
        );

        // Check if connection is a zombie (connected but no bytes received)
        if (isHealthy && pc) {
          try {
            const stats = await pc.getStats();
            let currentBytes = 0;
            stats.forEach(report => {
              if (report.type === "inbound-rtp" && (report.kind === "video" || report.kind === "audio")) {
                currentBytes += (report.bytesReceived || 0);
              }
            });

            const receivers = pc.getReceivers();
            const hasActiveTracks = receivers.some(r => r.track && r.track.enabled && !r.track.muted && r.track.readyState === "live");

            const lastData = lastBytesReceivedRef.current[peerId];
            const checkTime = Date.now();
            if (lastData) {
              const byteDelta = currentBytes - lastData.bytes;
              const timeDelta = checkTime - lastData.timestamp;

              if (byteDelta === 0) {
                // Scenario A: Stream was previously sending bytes but now stopped (frozen/stuck) for more than 60s (and it has active, unmuted tracks)
                if (lastData.bytes > 0 && timeDelta > 60000 && hasActiveTracks) {
                  console.warn(`[OBS Health Check] WebRTC Peer ${peerId} is a ZOMBIE connection (previously active, but frozen for 60s with active tracks). Forcing recovery.`);
                  isHealthy = false;
                }
                // Scenario B: Stream connected but never sent any bytes for more than 90s
                else if (lastData.bytes === 0 && timeDelta > 90000) {
                  console.warn(`[OBS Health Check] WebRTC Peer ${peerId} is a STUCK connection (connected but 0 bytes received for 90s). Forcing recovery.`);
                  isHealthy = false;
                }
              } else {
                // Bytes changed, update timestamp and bytes
                lastBytesReceivedRef.current[peerId] = { bytes: currentBytes, timestamp: checkTime };
              }
            } else {
              // Initialize
              lastBytesReceivedRef.current[peerId] = { bytes: currentBytes, timestamp: checkTime };
            }
          } catch (e) {
            console.error("[OBS Health Check] getStats error:", e);
          }
        }

        if (!isHealthy) {
          const checkTime = Date.now();
          const lastRequest = lastRequestTimeRef.current[peerId] || 0;
          if (checkTime - lastRequest > 10000) {
            console.log(`[OBS Health Check] Stream with peer ${peerId} is UNHEALTHY (${pc ? pc.connectionState : "NO_PC"}). Re-requesting stream...`);
            lastRequestTimeRef.current[peerId] = checkTime;
            requestPeerStream(peerId);
          }
        }
      });
    }, 5000); // Check every 5 seconds for ultimate reliability

    return () => clearInterval(interval);
  }, [isPreview, localStreams]);

  const cleanupSignalingStateForPeer = (peerId: string) => {
    // 1. Close RTCPeerConnection if exists
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      console.log(`[Signaling Cleanup] [OBS] Closing and destroying PeerConnection with ${peerId}`);
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch (e) {
        console.warn(`[Signaling Cleanup] [OBS] Error closing PC for ${peerId}:`, e);
      }
      delete peerConnectionsRef.current[peerId];
    }

    // Stop and cleanup stale stream tracks for this peer to release hardware/memory resources
    setPeerStreams(prev => {
      const existing = prev[peerId];
      if (existing && existing.stream) {
        console.log(`[Signaling Cleanup] [OBS] Stopping stale stream tracks for peer ${peerId}`);
        existing.stream.getTracks().forEach(t => {
          try {
            t.stop();
          } catch (err) {}
        });
      }
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });

    // 2. Remove any queued ICE candidates for this peer
    if (pendingIceCandidatesRef.current[peerId]) {
      console.log(`[Signaling Cleanup] [OBS] Clearing pending ICE candidates for ${peerId}`);
      delete pendingIceCandidatesRef.current[peerId];
    }

    // 3. Filter out any unsent signaling messages destined for this peer from the WebSocket pending queue
    if (pendingMessagesRef.current && pendingMessagesRef.current.length > 0) {
      const originalCount = pendingMessagesRef.current.length;
      pendingMessagesRef.current = pendingMessagesRef.current.filter(msg => msg.targetId !== peerId);
      const diff = originalCount - pendingMessagesRef.current.length;
      if (diff > 0) {
        console.log(`[Signaling Cleanup] [OBS] Removed ${diff} stale unsent signaling messages from queue for peer ${peerId}`);
      }
    }
  };

  // Connect to the generic signaling server as role "obs"
  const connectSignaling = () => {
    lastMessageTimeRef.current = Date.now();
    // Deduplicate: Close existing connection if any before opening a new one
    if (wsRef.current) {
      console.log("[OBS Renderer] Closing existing WebSocket before establishing a new one...");
      try {
        wsRef.current.onclose = null; // Detach onclose listener to avoid triggering redundant reconnection
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch (e) {
        console.warn("[OBS Renderer] Error closing previous WebSocket:", e);
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const idParam = isPreview ? "obs_preview" : (soloPeerId ? `obs_solo_${soloPeerId}_${Math.random().toString(36).substring(2, 6)}` : obsUniqueIdRef.current);
    const wsUrl = `${protocol}//${window.location.host}/signaling?roomId=${roomId}&role=obs&id=${idParam}`;
    
    console.log("[OBS Renderer] Kết nối signaling:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let pingInterval: any = null;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      lastMessageTimeRef.current = Date.now();
      setWsConnected(true);
      console.log("[OBS Renderer] WebSocket connected. Flushing pending messages queue...");
      
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
          console.error("[OBS Renderer] Error flushing message, requeuing:", e);
          pendingMessagesRef.current.push(msg);
        }
      }
    };

    ws.onerror = (err) => {
      if (wsRef.current !== ws) return;
      console.error("[OBS Renderer] WebSocket error:", err);
      try {
        ws.close();
      } catch (e) {}
    };

    ws.onmessage = async (event) => {
      if (wsRef.current !== ws) return;
      lastMessageTimeRef.current = Date.now();
      try {
        const data = JSON.parse(event.data);
        console.log("[OBS WebRTC Received]", data.type, "từ", data.senderId);

        switch (data.type) {
          case "room-peers":
            console.log("[OBS Renderer] Danh sách các peer hiện tại trong phòng:", data.peers);
            // Restore saved settings from server if available (resilient layout protection)
            if (data.savedSettings && !isPreview) {
              console.log("[OBS Renderer] Restoring persisted room settings from server:", data.savedSettings);
              setSettings(data.savedSettings, false);
            }
            // Record peer metadata and request streams
            data.peers.forEach((peer: any) => {
              if (peer.role !== "obs") {
                peerNamesRef.current[peer.id] = { name: peer.name, role: peer.role };
                
                // Always clean up existing stale signaling states to prevent race conditions on reconnect
                console.log(`[OBS Renderer] Peer ${peer.id} found in room. Cleaning up stale states and requesting stream.`);
                cleanupSignalingStateForPeer(peer.id);
                requestPeerStream(peer.id);
              }
            });
            break;

          case "peer-connected":
            console.log(`[OBS Renderer] Peer mới gia nhập hoặc kết nối lại: ${data.name} (${data.role})`);
            if (data.role !== "obs") {
              peerNamesRef.current[data.senderId] = { name: data.name, role: data.role };
              
              // Always clean up existing stale signaling states to prevent race conditions on peer reconnect
              console.log(`[OBS Renderer] Peer ${data.senderId} reconnected. Cleaning up stale states and requesting stream.`);
              cleanupSignalingStateForPeer(data.senderId);
              requestPeerStream(data.senderId);
            }
            break;

          case "offer":
            // Receive offer from sender (host/athlete), create Answer
            handleReceiveOffer(data.senderId, data.sdp);
            break;

          case "ice-candidate":
            if (data.candidate) {
              const pc = peerConnectionsRef.current[data.senderId];
              if (pc) {
                try {
                  if (pc.remoteDescription) {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                  } else {
                    if (!(pc as any).iceCandidatesQueue) {
                      (pc as any).iceCandidatesQueue = [];
                    }
                    (pc as any).iceCandidatesQueue.push(data.candidate);
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
                console.log(`[OBS] Queued early ICE candidate for peer ${data.senderId}`);
              }
            }
            break;

          case "control-update":
            // Remote MC updated settings! Change immediately
            if (data.settings && !isPreview) {
              const oldUse4G = settingsRef.current?.use4GMode;
              const newUse4G = data.settings.use4GMode;
              setSettings(data.settings, false);
              
              if (oldUse4G !== newUse4G) {
                console.log("[OBS] Chế độ 4G thay đổi. Đang yêu cầu kết nối lại với cấu hình WebRTC mới...");
                // Request stream again from all peers to trigger a new offer and connection recreate
                Object.keys(peerConnectionsRef.current).forEach(peerId => {
                  requestPeerStream(peerId);
                });
              }
            }
            break;

          case "trigger-vfx":
            if (data.name === "confetti") {
              setShowConfetti(true);
              const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2013/2013-84.wav"); // short celebrate sound
              audio.volume = 0.2;
              audio.play().catch(() => {});
              setTimeout(() => {
                setShowConfetti(false);
              }, 7000);
            }
            break;

          case "camera-state":
            setPeerStreams(prev => {
              const existing = prev[data.senderId];
              if (existing) {
                return {
                  ...prev,
                  [data.senderId]: {
                    ...existing,
                    isMirrored: data.isMirrored,
                    facingMode: data.facingMode
                  }
                };
              }
              return prev;
            });
            break;

          case "peer-disconnected":
            console.log(`[OBS Renderer] Peer signaling ngắt kết nối: ${data.senderId}`);
            {
              const activePc = peerConnectionsRef.current[data.senderId];
              const isWebrtcHealthy = activePc && 
                (activePc.connectionState === "connected" || activePc.iceConnectionState === "connected" || activePc.iceConnectionState === "completed");
              
              if (isWebrtcHealthy) {
                console.log(`[OBS Renderer] WebRTC stream with ${data.senderId} is still healthy. Keeping stream alive.`);
              } else {
                console.log(`[OBS Renderer] WebRTC connection with ${data.senderId} is inactive/dead. Cleaning up.`);
                cleanupSignalingStateForPeer(data.senderId);
                setPeerStreams(prev => {
                  const copy = { ...prev };
                  delete copy[data.senderId];
                  return copy;
                });
                if (data.senderId !== "host" && peerNamesRef.current[data.senderId]) {
                  delete peerNamesRef.current[data.senderId];
                }
              }
            }
            break;
        }
      } catch (err) {
        console.error("[OBS Renderer] Lỗi xử lý message:", err);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) {
        console.log("[OBS Renderer] Ignored close event for old/superseded WebSocket connection.");
        return;
      }
      setWsConnected(false);
      if (pingInterval) clearInterval(pingInterval);
      console.log("[OBS Renderer] WebSocket closed. Đang kết nối lại...");
      setTimeout(() => {
        if (wsRef.current === ws) {
          connectSignaling();
        }
      }, 3000);
    };
  };

  // Send request stream trigger to peer
  const requestPeerStream = (targetId: string) => {
    console.log(`[OBS Renderer] requestPeerStream: Cleaning up state for ${targetId} and sending request-stream...`);
    cleanupSignalingStateForPeer(targetId);
    sendOrQueueSignalingMessage({
      type: "request-stream",
      targetId: targetId
    });
  };

  // Receive offer from host or athlete, make local Answer
  const handleReceiveOffer = async (peerId: string, sdp: string) => {
    try {
      console.log(`[OBS Renderer] Receiving WebRTC Offer from ${peerId}. Cleaning up prior state to avoid collisions...`);
      cleanupSignalingStateForPeer(peerId);

      const pc = new RTCPeerConnection(getWebRtcConfig(!!settings?.use4GMode));
      (pc as any).iceCandidatesQueue = [];
      peerConnectionsRef.current[peerId] = pc;

      // Apply any early queued ICE candidates for this peer
      const earlyCandidates = pendingIceCandidatesRef.current[peerId];
      if (earlyCandidates && earlyCandidates.length > 0) {
        console.log(`[OBS] Applying ${earlyCandidates.length} queued early ICE candidates to new PC for Peer ${peerId}`);
        earlyCandidates.forEach(cand => {
          (pc as any).iceCandidatesQueue.push(cand);
        });
        delete pendingIceCandidatesRef.current[peerId];
      }

      pc.ontrack = (event) => {
        console.log(`[MEDIA_PIPELINE] [OBS-Renderer] ontrack() FIRED! Peer: ${peerId}, Track ID: ${event.track.id}, Kind: ${event.track.kind}, Label: ${event.track.label}`);
        console.log(`[MEDIA_PIPELINE] [OBS-Renderer] ontrack() Number of streams:`, event.streams.length);

        console.log(`[OBS Renderer] Nhận luồng A/V từ ${peerId}`);
        const meta = peerNamesRef.current[peerId] || { name: "Thành viên", role: "athlete" };
        
        setPeerStreams(prev => {
          // Rebuild fresh MediaStream only using active, live tracks from this current RTCPeerConnection instance.
          // This ensures we NEVER blend stale ended tracks from previous closed connections.
          const activeTracks = pc.getReceivers()
            .map(r => r.track)
            .filter(t => t && t.readyState === "live");
            
          if (activeTracks.length === 0 && event.streams[0]) {
            event.streams[0].getTracks().forEach(t => {
              if (t.readyState === "live") activeTracks.push(t);
            });
          }
          
          if (activeTracks.indexOf(event.track) === -1) {
            activeTracks.push(event.track);
          }

          const freshStream = new MediaStream();
          activeTracks.forEach(track => {
            freshStream.addTrack(track);
          });

          console.log(`[OBS Renderer] Re-built clean MediaStream for ${peerId} with ${activeTracks.length} live tracks.`);
          return {
            ...prev,
            [peerId]: {
              stream: freshStream,
              name: meta.name,
              role: meta.role as "host" | "athlete" | "obs"
            }
          };
        });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendOrQueueSignalingMessage({
            type: "ice-candidate",
            candidate: event.candidate,
            targetId: peerId
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[OBS Renderer] WebRTC Connection State with ${peerId}:`, pc.connectionState);
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          if ((pc as any).isReconnecting) return;
          (pc as any).isReconnecting = true;
          console.warn(`[OBS Renderer] Kết nối với ${peerId} bị ngắt (${pc.connectionState}). Đang yêu cầu gửi lại luồng...`);
          setTimeout(() => {
            if (peerConnectionsRef.current[peerId] === pc) {
              requestPeerStream(peerId);
            }
          }, 250);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[OBS Renderer] ICE Connection State with ${peerId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          if ((pc as any).isReconnecting) return;
          (pc as any).isReconnecting = true;
          console.warn(`[OBS Renderer] ICE với ${peerId} bị ngắt (${pc.iceConnectionState}). Đang yêu cầu gửi lại luồng...`);
          setTimeout(() => {
            if (peerConnectionsRef.current[peerId] === pc) {
              requestPeerStream(peerId);
            }
          }, 250);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
      const answer = await pc.createAnswer();
      let answerSdp = answer.sdp || "";
      if (answerSdp) {
        answerSdp = preferH264(answerSdp);
        const hasVideo = answerSdp.includes("m=video");
        const hasSendRecv = answerSdp.includes("a=sendrecv") || answerSdp.includes("a=sendonly") || answerSdp.includes("a=recvonly");
        console.log(`[MEDIA_PIPELINE] [OBS-to-${peerId}] SDP VERIFICATION (H264 Preferred): m=video exists: ${hasVideo}, sendrecv/sendonly/recvonly exists: ${hasSendRecv}`);
      } else {
        console.warn(`[MEDIA_PIPELINE] [OBS-to-${peerId}] SDP is undefined!`);
      }
      await pc.setLocalDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));

      sendOrQueueSignalingMessage({
        type: "answer",
        sdp: answerSdp,
        targetId: peerId
      });

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

    } catch (err) {
      console.error(`[OBS Renderer] Lỗi nhận Offer từ ${peerId}:`, err);
    }
  };

  // Scoreboard drag & resize handlers
  const handleScoreboardDragStart = (e: React.MouseEvent) => {
    if (!isPreview || !onUpdateSettings) return;

    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest(".no-drag") || target.closest("select")) {
      return;
    }

    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    
    const isVertical = settings.aspectRatio === "9:16";
    const currentPos = settings.scoreboardPosition || (
      isVertical ? { x: 2, y: 15, w: 96, h: 25 } : { x: 4, y: 12, w: 24, h: 32 }
    );

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const container = document.getElementById("obs-main-wrapper");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;

      const newX = Math.max(0, Math.min(100 - currentPos.w, currentPos.x + pctDeltaX));
      const newY = Math.max(0, Math.min(100 - currentPos.h, currentPos.y + pctDeltaY));

      const updated = {
        ...settings,
        scoreboardPosition: {
          x: Math.round(newX * 10) / 10,
          y: Math.round(newY * 10) / 10,
          w: currentPos.w,
          h: currentPos.h
        }
      };
      setSettings(updated);
      onUpdateSettings(updated);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handlePipDragStart = (e: React.MouseEvent) => {
    if (!isPreview || !onUpdateSettings) return;

    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest(".no-drag") || target.closest("select")) {
      return;
    }

    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    const container = document.getElementById("obs-main-wrapper");
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const currentPos = settings.pipLayoutPosition || { x: 80, y: 70 };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;

      const newX = Math.max(0, Math.min(100, currentPos.x + pctDeltaX));
      const newY = Math.max(0, Math.min(100, currentPos.y + pctDeltaY));

      const updated = {
        ...settings,
        pipLayoutPosition: {
          x: Math.round(newX * 10) / 10,
          y: Math.round(newY * 10) / 10
        }
      };
      setSettings(updated, false);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      setSettings({ ...settingsRef.current }, true);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleScoreboardResizeStart = (e: React.MouseEvent) => {
    if (!isPreview || !onUpdateSettings) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    const isVertical = settings.aspectRatio === "9:16";
    const currentPos = settings.scoreboardPosition || (
      isVertical ? { x: 2, y: 15, w: 96, h: 25 } : { x: 4, y: 12, w: 24, h: 32 }
    );

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const container = document.getElementById("obs-main-wrapper");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;

      const newW = Math.max(10, Math.min(100 - currentPos.x, currentPos.w + pctDeltaX));
      const newH = Math.max(10, Math.min(100 - currentPos.y, currentPos.h + pctDeltaY));

      const updated = {
        ...settings,
        scoreboardPosition: {
          x: currentPos.x,
          y: currentPos.y,
          w: Math.round(newW * 10) / 10,
          h: Math.round(newH * 10) / 10
        }
      };
      setSettings(updated);
      onUpdateSettings(updated);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleScoreboardCropChange = (side: "top" | "bottom" | "left" | "right", val: number) => {
    if (!onUpdateSettings) return;
    const currentCrop = settings.scoreboardCrop || { top: 0, bottom: 0, left: 0, right: 0 };
    const updatedCrop = {
      ...currentCrop,
      [side]: val
    };
    const updated = {
      ...settings,
      scoreboardCrop: updatedCrop
    };
    setSettings(updated);
    onUpdateSettings(updated);
  };

  // Helper to calculate RGBA color from Hex and opacity (0-100)
  const getRgbaColor = (hex: string, opacity: number = 100) => {
    if (!hex) return "rgba(15, 23, 42, 1)";
    let cleanHex = hex.replace("#", "");
    if (cleanHex.length === 3) {
      cleanHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
    }
    const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
    const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
    const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
  };

  // Generic drag handler for custom elements
  const handleElementDragStart = (e: React.MouseEvent, key: "logo" | "banner" | "ticker" | "lowerThird", defaultPos: { x: number; y: number; w: number; h: number }) => {
    if (!isPreview || !onUpdateSettings) return;

    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest(".no-drag") || target.closest("select")) {
      return;
    }

    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    
    let currentPos = defaultPos;
    if (key === "logo" && settingsRef.current.logoPositionCustom) currentPos = settingsRef.current.logoPositionCustom;
    else if (key === "banner" && settingsRef.current.bannerPosition) currentPos = settingsRef.current.bannerPosition;
    else if (key === "ticker" && settingsRef.current.tickerPosition) currentPos = settingsRef.current.tickerPosition;
    else if (key === "lowerThird" && settingsRef.current.lowerThirdPosition) currentPos = settingsRef.current.lowerThirdPosition;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const container = document.getElementById("obs-main-wrapper");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;

      const newX = Math.max(0, Math.min(100 - currentPos.w, currentPos.x + pctDeltaX));
      const newY = Math.max(0, Math.min(100 - currentPos.h, currentPos.y + pctDeltaY));

      const updatedPos = {
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        w: currentPos.w,
        h: currentPos.h
      };

      const updated = {
        ...settingsRef.current,
        [key === "logo" ? "logoPositionCustom" : key === "banner" ? "bannerPosition" : key === "ticker" ? "tickerPosition" : "lowerThirdPosition"]: updatedPos
      };
      setSettings(updated, false);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      // Commit final position to OBS
      setSettings({ ...settingsRef.current }, true);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Generic resize handler for custom elements
  const handleElementResizeStart = (e: React.MouseEvent, key: "logo" | "banner" | "ticker" | "lowerThird", defaultPos: { x: number; y: number; w: number; h: number }) => {
    if (!isPreview || !onUpdateSettings) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    let currentPos = defaultPos;
    if (key === "logo" && settingsRef.current.logoPositionCustom) currentPos = settingsRef.current.logoPositionCustom;
    else if (key === "banner" && settingsRef.current.bannerPosition) currentPos = settingsRef.current.bannerPosition;
    else if (key === "ticker" && settingsRef.current.tickerPosition) currentPos = settingsRef.current.tickerPosition;
    else if (key === "lowerThird" && settingsRef.current.lowerThirdPosition) currentPos = settingsRef.current.lowerThirdPosition;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const container = document.getElementById("obs-main-wrapper");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;

      const newW = Math.max(5, Math.min(100 - currentPos.x, currentPos.w + pctDeltaX));
      const newH = Math.max(5, Math.min(100 - currentPos.y, currentPos.h + pctDeltaY));

      const updatedPos = {
        x: currentPos.x,
        y: currentPos.y,
        w: Math.round(newW * 10) / 10,
        h: Math.round(newH * 10) / 10
      };

      const updated = {
        ...settingsRef.current,
        [key === "logo" ? "logoPositionCustom" : key === "banner" ? "bannerPosition" : key === "ticker" ? "tickerPosition" : "lowerThirdPosition"]: updatedPos
      };
      setSettings(updated, false);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      // Commit final position to OBS
      setSettings({ ...settingsRef.current }, true);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Generic crop handler for custom elements
  const handleElementCropChange = (key: "logo" | "banner" | "ticker" | "lowerThird", side: "top" | "bottom" | "left" | "right", val: number) => {
    if (!onUpdateSettings) return;
    
    const cropKey = key === "logo" ? "logoCrop" : key === "banner" ? "bannerCrop" : key === "ticker" ? "tickerCrop" : "lowerThirdCrop";
    const currentCrop = settingsRef.current[cropKey] || { top: 0, bottom: 0, left: 0, right: 0 };
    
    const nextCrop = {
      ...currentCrop,
      [side]: val
    };

    const updated = {
      ...settingsRef.current,
      [cropKey]: nextCrop
    };
    setSettings(updated);
    onUpdateSettings(updated);
  };

  // Build the list of active video elements depending on layout, filtering out hidden peers and sorting by order.
  // We include both active/connected WebRTC streams AND any pre-configured visible athlete slots 
  // (which will display as a beautiful connecting placeholder "VĐV ĐANG KẾT NỐI..." if offline).
  const mainActivePeers = (() => {
    const list: [string, PeerStreamInfo][] = [];
    const addedIds = new Set<string>();

    // 1. Add Host / MC if available in peerStreams, or if we are in preview mode, fallback to localStreams
    const hostStream = peerStreams["host"];
    if (hostStream) {
      list.push(["host", hostStream]);
      addedIds.add("host");
    } else if (isPreview && localStreams?.["host"]?.stream) {
      list.push(["host", {
        stream: localStreams["host"].stream,
        name: localStreams["host"].name || "MC BAN TỔ CHỨC",
        role: "host",
        isMirrored: localStreams["host"].isMirrored
      }]);
      addedIds.add("host");
    } else if (isPreview && !localStreams) {
      list.push(["host", {
        stream: undefined,
        name: "MC BAN TỔ CHỨC",
        role: "host",
        isMirrored: false
      }]);
      addedIds.add("host");
    }

    // 2. Add pre-configured visible athlete slots
    const visibleCount = settings.visibleSlotsCount ?? 1;
    const invites = settings.athleteInvites || [];
    for (let i = 0; i < visibleCount; i++) {
      const invite = invites[i] || { id: `inv_${i + 1}`, name: `Vận động viên ${i + 1}` };
      const id = invite.id;
      
      const connectedStream = peerStreams[id];
      if (connectedStream) {
        list.push([id, connectedStream]);
      } else {
        list.push([id, {
          stream: undefined,
          name: invite.name,
          role: "athlete",
          isMirrored: false
        }]);
      }
      addedIds.add(id);
    }

    // 3. Add any other connected streams (like OBS receiver or other roles) that were not already added
    Object.entries(peerStreams).forEach(([id, info]) => {
      if (!addedIds.has(id)) {
        list.push([id, info as PeerStreamInfo]);
        addedIds.add(id);
      }
    });

    // 4. Filter out any hidden peers and sort by peerOrder
    return list
      .filter(([peerId]) => !settings.hiddenPeers?.[peerId])
      .sort((a, b) => {
        const order = settings.peerOrder || [];
        const indexA = order.indexOf(a[0]);
        const indexB = order.indexOf(b[0]);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return -1;
        if (indexB === -1) return 1;
        return indexA - indexB;
      });
  })();

  const activePeers = (() => {
    if (soloPeerId) {
      const list: [string, PeerStreamInfo][] = [];
      const connectedStream = peerStreams[soloPeerId];
      if (connectedStream) {
        list.push([soloPeerId, connectedStream]);
      } else {
        const invites = settings.athleteInvites || [];
        const invite = invites.find(inv => inv.id === soloPeerId) || { id: soloPeerId, name: `Vận động viên (${soloPeerId})` };
        list.push([soloPeerId, {
          stream: undefined,
          name: invite.name,
          role: "athlete",
          isMirrored: false
        }]);
      }
      return list;
    }
    return mainActivePeers;
  })();

  // Background Style helper
  const getBackgroundClass = () => {
    switch (settings.backgroundStyle) {
      case "transparent":
        return "bg-transparent";
      case "dark-slate":
        return "bg-slate-900";
      case "neon-cyber":
        return "bg-slate-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]";
      case "soft-gradient":
        return "bg-gradient-to-br from-indigo-950 via-slate-900 to-emerald-950";
      default:
        return "bg-transparent";
    }
  };

  // Layout helper: returns the class styles of grid columns
  const getLayoutClass = () => {
    const isVertical = settings.aspectRatio === "9:16";
    if (isVertical) return "grid-cols-1 max-w-full w-full h-full";
    if (isPreview) {
      if (activePeers.length <= 1) return "grid-cols-1 max-w-4xl";
      if (settings.layout === "split") return "grid-cols-2 max-w-7xl";
      if (settings.layout === "side-by-side") return "grid-cols-2 gap-8 max-w-7xl";
      if (settings.layout === "grid") {
        if (activePeers.length <= 2) return "grid-cols-2 max-w-6xl";
        return "grid-cols-2 lg:grid-cols-3 max-w-7xl";
      }
      return "grid-cols-1 max-w-5xl";
    } else {
      // Live OBS broadcast output - remove all max-width restrictions to allow 100% full-bleed
      if (activePeers.length <= 1) return "grid-cols-1 max-w-full w-full h-full";
      if (settings.layout === "split") return "grid-cols-2 max-w-full w-full h-full";
      if (settings.layout === "side-by-side") return "grid-cols-2 gap-4 max-w-full w-full h-full";
      if (settings.layout === "grid") {
        if (activePeers.length <= 2) return "grid-cols-2 max-w-full w-full h-full";
        return "grid-cols-2 lg:grid-cols-3 max-w-full w-full h-full";
      }
      return "grid-cols-1 max-w-full w-full h-full";
    }
  };

  const isVertical = settings.aspectRatio === "9:16";

  return (
    <div className={isPreview ? "w-full h-full relative font-sans overflow-hidden bg-slate-900" : `h-screen ${isVertical ? "bg-slate-950 flex items-center justify-center" : getBackgroundClass()} overflow-hidden relative font-sans w-full m-0 p-0`}>
      <div 
        id="obs-main-wrapper"
        className={`relative flex flex-col justify-between overflow-hidden transition-all duration-300 ${
          isPreview
            ? "w-full h-full bg-slate-900"
            : isVertical 
              ? "w-full h-screen bg-slate-950" 
              : `h-screen w-full ${getBackgroundClass()}`
        }`}
      >
      
      {/* 1. CONFETTI EFFECT (Dynamic overlay) */}
      <ConfettiCanvas active={showConfetti} />

      {/* 2. TOP BANNER GRAPHIC */}
      {settings.showBanner && !soloPeerId && (() => {
        const defaultBannerPos = { x: 0, y: 0, w: 100, h: 8 };
        const bannerPos = settings.bannerPosition || defaultBannerPos;
        const bannerCrop = settings.bannerCrop || { top: 0, bottom: 0, left: 0, right: 0 };
        const hasBannerCrop = bannerCrop.top > 0 || bannerCrop.bottom > 0 || bannerCrop.left > 0 || bannerCrop.right > 0;
        const bannerClipPathStyle = hasBannerCrop 
          ? `inset(${bannerCrop.top}% ${bannerCrop.right}% ${bannerCrop.bottom}% ${bannerCrop.left}%)` 
          : undefined;

        return (
          <div 
            className={`absolute z-40 flex items-center justify-between font-mono font-bold shadow-lg uppercase border-b select-none animate-slide-down transition-all duration-75 ${
              isPreview ? "border border-cyan-500/50 hover:border-cyan-400 group cursor-move" : ""
            }`}
            style={{
              left: `${bannerPos.x}%`,
              top: `${bannerPos.y}%`,
              width: `${bannerPos.w}%`,
              height: `${bannerPos.h}%`,
              clipPath: bannerClipPathStyle,
              backgroundColor: getRgbaColor(settings.bannerBgColor, settings.bannerBgOpacity ?? 100),
              borderBottomColor: getRgbaColor("#ffffff", (settings.bannerBgOpacity ?? 100) * 0.1),
              borderColor: isPreview ? getRgbaColor("#22d3ee", (settings.bannerBgOpacity ?? 100) * 0.5) : undefined,
              color: settings.bannerTextColor,
              padding: "0 1.5rem"
            }}
            onMouseDown={(e) => handleElementDragStart(e, "banner", defaultBannerPos)}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-300 animate-pulse" />
              <span className="text-[10px] sm:text-xs tracking-wider">LIVE </span>
            </div>
            <span className="text-xs sm:text-sm tracking-widest truncate max-w-[65%]">{settings.bannerText}</span>
            <span className="text-[10px] bg-black/40 px-2 py-0.5 rounded border border-white/10 hidden sm:inline font-bold">R: {roomId}</span>

            {/* Controls for Preview Mode */}
            {isPreview && (
              <>
                <div 
                  className="absolute bottom-0 right-0 w-4 h-4 bg-cyan-500 cursor-se-resize flex items-center justify-center z-50 hover:bg-cyan-400 no-drag"
                  onMouseDown={(e) => handleElementResizeStart(e, "banner", defaultBannerPos)}
                >
                  <Maximize2 className="h-2 w-2 text-slate-950 rotate-90" />
                </div>

                <button 
                  onClick={(e) => { e.stopPropagation(); setShowBannerCropMenu(!showBannerCropMenu); }}
                  className="absolute top-1/2 -translate-y-1/2 right-12 bg-slate-950/85 hover:bg-slate-900 border border-white/20 text-white rounded p-1 text-[8px] flex items-center gap-1 z-50 select-none cursor-pointer no-drag font-bold"
                >
                  <Crop className="h-3 w-3 text-cyan-400" />
                  <span>CẮT KHUNG</span>
                </button>

                {showBannerCropMenu && (
                  <div className="absolute top-10 right-12 bg-slate-950 border border-cyan-500/40 p-3 rounded-lg shadow-2xl text-white z-55 w-52 no-drag text-left lowercase font-mono">
                    <h5 className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider mb-2 flex items-center justify-between">
                      <span>Cắt Banner Đỉnh</span>
                      <button onClick={(e) => { e.stopPropagation(); setShowBannerCropMenu(false); }} className="text-slate-400 hover:text-white">✕</button>
                    </h5>
                    <div className="space-y-2 text-[10px]">
                      {["top", "bottom", "left", "right"].map((side) => (
                        <div key={side}>
                          <div className="flex justify-between mb-0.5 text-slate-400">
                            <span className="capitalize">{side}:</span>
                            <span>{bannerCrop[side as "top"|"bottom"|"left"|"right"]}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="90" 
                            value={bannerCrop[side as "top"|"bottom"|"left"|"right"]}
                            onChange={(e) => handleElementCropChange("banner", side as any, parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* 3. BRAND LOGO */}
      {settings.logoUrl && !soloPeerId && (() => {
        const size = settings.logoSize || 12;
        const isVerticalRatio = settings.aspectRatio === "9:16";
        const defaultLogoPos = settings.logoPosition === "top-right" ? { x: 100 - size - 4, y: isVerticalRatio ? 4 : 12, w: size, h: size } :
                              settings.logoPosition === "top-left" ? { x: 4, y: isVerticalRatio ? 4 : 12, w: size, h: size } :
                              settings.logoPosition === "bottom-right" ? { x: 100 - size - 4, y: isVerticalRatio ? 84 : 76, w: size, h: size } :
                              { x: 4, y: isVerticalRatio ? 84 : 76, w: size, h: size };
        const logoPos = settings.logoPositionCustom || defaultLogoPos;
        const logoCrop = settings.logoCrop || { top: 0, bottom: 0, left: 0, right: 0 };
        const hasLogoCrop = logoCrop.top > 0 || logoCrop.bottom > 0 || logoCrop.left > 0 || logoCrop.right > 0;
        const logoClipPathStyle = hasLogoCrop 
          ? `inset(${logoCrop.top}% ${logoCrop.right}% ${logoCrop.bottom}% ${logoCrop.left}%)` 
          : undefined;

        return (
          <div 
            className={`absolute z-45 transition-all duration-75 flex items-center justify-center select-none shadow-md ${
              isPreview ? "border border-cyan-500/50 hover:border-cyan-400 cursor-move group" : ""
            }`}
            style={{
              left: `${logoPos.x}%`,
              top: `${logoPos.y}%`,
              width: `${logoPos.w}%`,
              height: `${logoPos.h}%`,
              clipPath: logoClipPathStyle,
            }}
            onMouseDown={(e) => handleElementDragStart(e, "logo", defaultLogoPos)}
          >
            <img
              src={settings.logoUrl}
              referrerPolicy="no-referrer"
              alt="Brand Logo"
              className="w-full h-full object-contain"
            />

            {/* Controls for Preview Mode */}
            {isPreview && (
              <>
                <div 
                  className="absolute bottom-0 right-0 w-4 h-4 bg-cyan-500 cursor-se-resize flex items-center justify-center z-50 hover:bg-cyan-400 no-drag"
                  onMouseDown={(e) => handleElementResizeStart(e, "logo", defaultLogoPos)}
                >
                  <Maximize2 className="h-2 w-2 text-slate-950 rotate-90" />
                </div>

                <button 
                  onClick={(e) => { e.stopPropagation(); setShowLogoCropMenu(!showLogoCropMenu); }}
                  className="absolute -top-6 right-0 bg-slate-950/85 hover:bg-slate-900 border border-white/20 text-white rounded px-1.5 py-0.5 text-[8px] flex items-center gap-1 z-50 select-none cursor-pointer no-drag font-bold"
                >
                  <Crop className="h-2.5 w-2.5 text-cyan-400" />
                  <span>CẮT</span>
                </button>

                {showLogoCropMenu && (
                  <div className="absolute top-6 right-0 bg-slate-950 border border-cyan-500/40 p-3 rounded-lg shadow-2xl text-white z-55 w-52 no-drag text-left lowercase font-mono">
                    <h5 className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider mb-2 flex items-center justify-between">
                      <span>Cắt Logo</span>
                      <button onClick={(e) => { e.stopPropagation(); setShowLogoCropMenu(false); }} className="text-slate-400 hover:text-white">✕</button>
                    </h5>
                    <div className="space-y-2 text-[10px]">
                      {["top", "bottom", "left", "right"].map((side) => (
                        <div key={side}>
                          <div className="flex justify-between mb-0.5 text-slate-400">
                            <span className="capitalize">{side}:</span>
                            <span>{logoCrop[side as "top"|"bottom"|"left"|"right"]}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="90" 
                            value={logoCrop[side as "top"|"bottom"|"left"|"right"]}
                            onChange={(e) => handleElementCropChange("logo", side as any, parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* 4. ACTIVE SCOREBOARD OVERLAY */}
      {settings.showScoreboard && !soloPeerId && (() => {
        const isVertical = settings.aspectRatio === "9:16";
        const defaultSbPos = isVertical 
          ? { x: 2, y: 15, w: 96, h: 20 }
          : { x: 4, y: 12, w: 24, h: 32 };
        const sbPos = settings.scoreboardPosition || defaultSbPos;
        const sbCrop = settings.scoreboardCrop || { top: 0, bottom: 0, left: 0, right: 0 };
        const hasSbCrop = sbCrop.top > 0 || sbCrop.bottom > 0 || sbCrop.left > 0 || sbCrop.right > 0;
        const sbClipPathStyle = hasSbCrop 
          ? `inset(${sbCrop.top}% ${sbCrop.right}% ${sbCrop.bottom}% ${sbCrop.left}%)` 
          : undefined;

        const sbBgOpacity = settings.scoreboardBgOpacity !== undefined ? settings.scoreboardBgOpacity : 80;
        const sbBgBlur = settings.scoreboardBgBlur !== undefined ? settings.scoreboardBgBlur : 12;
        return (
          <div 
            className={`absolute z-40 border rounded-xl shadow-2xl text-white font-mono uppercase transition-all duration-75 flex flex-col overflow-hidden ${
              isPreview ? "hover:border-cyan-400 group cursor-move select-none" : ""
            }`}
            style={{
              left: `${sbPos.x}%`,
              top: `${sbPos.y}%`,
              width: `${sbPos.w}%`,
              height: `${sbPos.h}%`,
              clipPath: sbClipPathStyle,
              backgroundColor: `rgba(15, 23, 42, ${sbBgOpacity / 100})`,
              borderColor: isPreview ? "rgba(6, 182, 212, 0.5)" : `rgba(255, 255, 255, ${(sbBgOpacity / 100) * 0.15})`,
              backdropFilter: `blur(${sbBgBlur}px)`,
              WebkitBackdropFilter: `blur(${sbBgBlur}px)`,
            }}
            onMouseDown={handleScoreboardDragStart}
          >
            <div className="flex items-center gap-2 border-b border-white/10 pb-2 mb-3 p-4">
              <Trophy className="h-5 w-5 text-yellow-400 shrink-0" />
              <div className="min-w-0">
                <h4 className="text-[10px] text-slate-400 tracking-wider leading-none truncate">{settings.scoreboardEventName}</h4>
                <h3 className="text-xs font-bold text-white tracking-wide mt-1 truncate">{settings.scoreboardTitle}</h3>
              </div>
            </div>
            
            <div className="space-y-2 flex-1 overflow-y-auto px-4 pb-4">
              {Object.entries(settings.scores).length === 0 ? (
                <span className="text-[10px] text-slate-400 block py-1">Chưa cập nhật điểm đấu...</span>
              ) : (
                Object.entries(settings.scores)
                  .sort((a, b) => ((b[1] as number) || 0) - ((a[1] as number) || 0)) // Sort highest points first!
                  .map(([clientId, score], idx) => {
                    const name = settings.scoreNames[clientId] || peerStreams[clientId]?.name || `VĐV ${idx + 1}`;
                    const isTop = idx === 0;
                    return (
                      <div key={clientId} className={`flex items-center justify-between p-1.5 rounded text-xs transition-all ${isTop ? "bg-amber-500/10 border border-amber-500/20" : "bg-black/20"}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`h-4.5 w-4.5 rounded-full text-[9px] font-bold flex items-center justify-center shrink-0 ${isTop ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300"}`}>
                            {idx + 1}
                          </span>
                          <span className="font-bold truncate max-w-[120px]">{name}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-slate-400">ĐIỂM:</span>
                          <ScoreDisplayWithFireworks score={score as number} clientId={clientId} className={`font-black ${isTop ? "text-amber-400" : "text-slate-200"}`} />
                        </div>
                      </div>
                    );
                  })
              )}
            </div>

            {/* Drag control panel overlay for preview mode */}
            {isPreview && (
              <>
                {/* Resize Handle */}
                <div 
                  className="absolute bottom-0 right-0 w-5 h-5 bg-cyan-500 rounded-tl cursor-se-resize flex items-center justify-center z-50 hover:bg-cyan-400 no-drag"
                  onMouseDown={handleScoreboardResizeStart}
                >
                  <Maximize2 className="h-2.5 w-2.5 text-slate-950 rotate-90" />
                </div>

                {/* Crop toggle Button */}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowScoreboardCropMenu(!showScoreboardCropMenu);
                  }}
                  className="absolute top-2 right-2 bg-slate-950/80 hover:bg-slate-900 border border-white/20 text-white rounded p-1 text-[10px] flex items-center gap-1 z-50 select-none cursor-pointer no-drag"
                  title="Crop Scoreboard"
                >
                  <Crop className="h-3.5 w-3.5 text-cyan-400" />
                </button>

                {/* Crop slider panel */}
                {showScoreboardCropMenu && (
                  <div className="absolute top-9 right-2 bg-slate-950 border border-cyan-500/40 p-3 rounded-lg shadow-2xl text-white z-55 w-52 no-drag text-left lowercase font-mono">
                    <h5 className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider mb-2 flex items-center justify-between">
                      <span>Cắt khung điểm</span>
                      <button onClick={(e) => { e.stopPropagation(); setShowScoreboardCropMenu(false); }} className="text-slate-400 hover:text-white">✕</button>
                    </h5>
                    <div className="space-y-2 text-[10px]">
                      <div>
                        <div className="flex justify-between mb-0.5 text-slate-400">
                          <span>Top:</span>
                          <span>{sbCrop.top}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="90" 
                          value={sbCrop.top}
                          onChange={(e) => handleScoreboardCropChange("top", parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between mb-0.5 text-slate-400">
                          <span>Bottom:</span>
                          <span>{sbCrop.bottom}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="90" 
                          value={sbCrop.bottom}
                          onChange={(e) => handleScoreboardCropChange("bottom", parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between mb-0.5 text-slate-400">
                          <span>Left:</span>
                          <span>{sbCrop.left}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="90" 
                          value={sbCrop.left}
                          onChange={(e) => handleScoreboardCropChange("left", parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between mb-0.5 text-slate-400">
                          <span>Right:</span>
                          <span>{sbCrop.right}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="90" 
                          value={sbCrop.right}
                          onChange={(e) => handleScoreboardCropChange("right", parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <div className="border-t border-slate-800/60 pt-2 mt-1">
                        <div className="flex justify-between mb-0.5 text-slate-400">
                          <span>Opacity:</span>
                          <span>{settings.scoreboardBgOpacity !== undefined ? settings.scoreboardBgOpacity : 80}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={settings.scoreboardBgOpacity !== undefined ? settings.scoreboardBgOpacity : 80}
                          onChange={(e) => {
                            if (onUpdateSettings) {
                              const updated = { ...settings, scoreboardBgOpacity: parseInt(e.target.value) };
                              setSettings(updated);
                              onUpdateSettings(updated);
                            }
                          }}
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onUpdateSettings) {
                            const updated = { ...settings, scoreboardCrop: { top: 0, bottom: 0, left: 0, right: 0 } };
                            setSettings(updated);
                            onUpdateSettings(updated);
                          }
                        }}
                        className="w-full py-1 mt-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[9px] uppercase font-bold"
                      >
                        Khôi phục Crop
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* 5. MAIN WebRTC PARTICIPANTS CONTAINER */}
      <div className={`flex-1 w-full h-full flex items-center justify-center z-20 ${isPreview ? "p-2" : "p-0"}`}>
        {activePeers.length === 0 ? (
          <div className="text-center space-y-3 font-mono text-slate-400 p-8 border border-dashed border-white/10 rounded-2xl max-w-md bg-slate-950/40 backdrop-blur-md">
            <Loader2 className="h-8 w-8 text-cyan-400 animate-spin mx-auto" />
            <p className="text-xs uppercase tracking-widest font-bold">Waiting for video stream signals...</p>
            <p className="text-[10px] text-slate-600 leading-normal">
              Liên kết OBS Browser Source thành công. Đang chờ luồng Webcam từ MC hoặc các Vận Động Viên từ xa.
            </p>
          </div>
        ) : settings.layout === "custom" ? (
          /* Render absolute canvas for Drag, Drop, Position, Crop layout */
          <div 
            id="obs-participants-container" 
            className={`select-none mx-auto ${
              isPreview 
                ? `relative w-full overflow-hidden border border-white/10 rounded-2xl bg-black shadow-2xl ${settings.aspectRatio === "9:16" ? "aspect-[9/16] max-h-[85vh]" : "aspect-video"}`
                : `absolute inset-0 w-full h-full bg-transparent`
            }`}
          >
            {activePeers.map(([peerId, info], idx) => {
              const pos = settings.peerPositions?.[peerId] || getInitialPosition(idx, activePeers.length);
              const isMC = info.role === "host" || peerId === "host";
              const zIndexStyle = isMC ? 50 : (settings.peerOrder ? settings.peerOrder.indexOf(peerId) + 10 : 10 + idx);
              const isPip = settings.pipPeers?.[peerId] ?? false;
              return (
                <div
                  key={peerId}
                  className={`absolute animate-fade-in transition-all duration-75 ${isPip ? "rounded-full" : ""}`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    width: `${pos.w}%`,
                    height: isPip ? "auto" : `${pos.h}%`,
                    aspectRatio: isPip ? "1 / 1" : undefined,
                    zIndex: zIndexStyle
                  }}
                >
                  <ObsVideoCard
                    peerId={peerId}
                    info={info}
                    settings={settings}
                    isPreview={isPreview}
                    onUpdateSettings={setSettings}
                    index={idx}
                    activePeers={activePeers}
                    isSolo={!!soloPeerId}
                    originalLayout={baseSettings.layout}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`grid gap-4 w-full justify-center items-center ${getLayoutClass()}`}>
            
            {/* If Single Layout active, render ONLY the highlighted client (or MC/Host if empty) */}
            {settings.layout === "single" ? (
              (() => {
                const highlightId = settings.highlightedClientId || activePeers[0][0];
                const targetPeer = peerStreams[highlightId] || activePeers[0][1];
                if (!targetPeer) return null;
                return (
                  <ObsVideoCard
                    peerId={highlightId}
                    info={targetPeer}
                    settings={settings}
                    isPreview={isPreview}
                    onUpdateSettings={setSettings}
                    index={mainActivePeers.findIndex(([id]) => id === highlightId) !== -1 ? mainActivePeers.findIndex(([id]) => id === highlightId) : 0}
                    activePeers={mainActivePeers}
                    isSolo={!!soloPeerId}
                    originalLayout={baseSettings.layout}
                  />
                );
              })()
            ) : settings.layout === "pip-host" || settings.layout === "pip-athlete" ? (
              /* Picture-in-Picture layout logic */
              (() => {
                const mainPeerId = settings.layout === "pip-host" 
                  ? (activePeers.find(([_, p]) => p.role === "athlete")?.[0] || activePeers[0][0])
                  : (activePeers.find(([_, p]) => p.role === "host")?.[0] || activePeers[0][0]);
                  
                const pipPeerId = settings.layout === "pip-host"
                  ? (activePeers.find(([_, p]) => p.role === "host")?.[0] || activePeers[1]?.[0])
                  : (activePeers.find(([_, p]) => p.role === "athlete")?.[0] || activePeers[1]?.[0]);

                const mainPeer = peerStreams[mainPeerId];
                const pipPeer = peerStreams[pipPeerId];

                return (
                  <div className={isPreview ? "relative w-full aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/10" : "relative w-full h-full"}>
                    {/* Main Full-size video */}
                    {mainPeer && (
                      <video
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                        style={{
                          transform: mainPeer.isMirrored !== undefined
                            ? (mainPeer.isMirrored ? "scaleX(-1)" : "scaleX(1)")
                            : (mainPeer.role === "athlete" ? "scaleX(-1)" : "scaleX(1)")
                        }}
                        ref={el => {
                          if (el) {
                            const isNewAssignment = el.srcObject !== mainPeer.stream;
                            if (isNewAssignment) {
                              el.srcObject = mainPeer.stream;
                              console.log(`[MEDIA_PIPELINE] [OBS main video] srcObject ASSIGNED new stream. readyState: ${el.readyState}`);
                            }
                            el.muted = isPreview;
                            el.play().catch(e => console.log(e));
                          }
                        }}
                      />
                    )}
                    {/* Float name overlay */}
                    <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 font-mono text-xs text-white">
                      {mainPeer?.name || "BẬT CHỦ SÓNG"}
                    </div>
 
                    {/* Small Floating Round PIP video */}
                    {pipPeer && (() => {
                      const pipPos = settings.pipLayoutPosition || { x: 85, y: 75 };
                      return (
                        <div 
                          className={`absolute w-44 h-44 rounded-full border-2 border-cyan-400 overflow-hidden shadow-2xl bg-black ${isPreview ? "cursor-move hover:border-cyan-300 z-50 animate-none" : ""}`}
                          style={{
                            left: `${pipPos.x}%`,
                            top: `${pipPos.y}%`,
                            transform: "translate(-50%, -50%)"
                          }}
                          onMouseDown={isPreview ? handlePipDragStart : undefined}
                        >
                          <video
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover"
                            style={{
                              transform: pipPeer.isMirrored !== undefined
                                ? (pipPeer.isMirrored ? "scaleX(-1)" : "scaleX(1)")
                                : (pipPeer.role === "athlete" ? "scaleX(-1)" : "scaleX(1)")
                            }}
                            ref={el => {
                              if (el) {
                                const isNewAssignment = el.srcObject !== pipPeer.stream;
                                if (isNewAssignment) {
                                  el.srcObject = pipPeer.stream;
                                  console.log(`[MEDIA_PIPELINE] [OBS pip video] srcObject ASSIGNED new stream. readyState: ${el.readyState}`);
                                }
                                el.muted = isPreview;
                                el.play().catch(e => console.log(e));
                              }
                            }}
                          />
                          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-black/80 px-2 py-0.5 rounded text-[9px] text-cyan-400 font-mono truncate max-w-[120px] select-none pointer-events-none">
                            {pipPeer.name}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()
            ) : (
              /* Default: Render all participants inside the configured layout columns */
              activePeers.map(([peerId, info], idx) => {
                const originalIdx = mainActivePeers.findIndex(([id]) => id === peerId);
                return (
                  <ObsVideoCard
                    key={peerId}
                    peerId={peerId}
                    info={info}
                    settings={settings}
                    isPreview={isPreview}
                    onUpdateSettings={setSettings}
                    index={originalIdx !== -1 ? originalIdx : idx}
                    activePeers={mainActivePeers}
                    isSolo={!!soloPeerId}
                    originalLayout={baseSettings.layout}
                  />
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 6. DYNAMIC LOWER THIRDS */}
      {settings.showLowerThirds && (() => {
        const isVerticalRatio = settings.aspectRatio === "9:16";
        const defaultLtPos = isVerticalRatio 
          ? { x: 2, y: 78, w: 96, h: 10 }
          : { x: 4, y: 76, w: 32, h: 12 };
        const ltPos = settings.lowerThirdPosition || defaultLtPos;
        const ltCrop = settings.lowerThirdCrop || { top: 0, bottom: 0, left: 0, right: 0 };
        const hasLtCrop = ltCrop.top > 0 || ltCrop.bottom > 0 || ltCrop.left > 0 || ltCrop.right > 0;
        const ltClipPathStyle = hasLtCrop 
          ? `inset(${ltCrop.top}% ${ltCrop.right}% ${ltCrop.bottom}% ${ltCrop.left}%)` 
          : undefined;

        const ltBgColor = settings.lowerThirdBgColor || "#059669";
        const ltBgOpacity = settings.lowerThirdBgOpacity ?? 100;

        return (
          <div 
            className={`absolute z-40 text-white px-6 py-3 rounded-l-lg border-l-4 shadow-2xl animate-fade-in select-none flex flex-col justify-center transition-all duration-75 ${
              isPreview ? "border border-cyan-500/50 hover:border-cyan-400 cursor-move group" : ""
            }`}
            style={{
              left: `${ltPos.x}%`,
              top: `${ltPos.y}%`,
              width: `${ltPos.w}%`,
              height: `${ltPos.h}%`,
              clipPath: ltClipPathStyle,
              background: `linear-gradient(90deg, ${getRgbaColor(ltBgColor, ltBgOpacity)} 0%, ${getRgbaColor("#0f172a", ltBgOpacity * 0.8)} 60%, transparent 100%)`,
              borderLeftColor: getRgbaColor(ltBgColor, ltBgOpacity),
            }}
            onMouseDown={(e) => handleElementDragStart(e, "lowerThird", defaultLtPos)}
          >
            <h4 className="text-[10px] text-emerald-400 font-mono uppercase tracking-widest leading-none">THÔNG TIN GIẢI ĐẤU</h4>
            <p className="text-xs sm:text-sm font-bold font-mono tracking-wide mt-1 text-white uppercase truncate">{settings.lowerThirdText}</p>

            {/* Controls for Preview Mode */}
            {isPreview && (
              <>
                <div 
                  className="absolute bottom-0 right-0 w-4 h-4 bg-cyan-500 cursor-se-resize flex items-center justify-center z-50 hover:bg-cyan-400 no-drag"
                  onMouseDown={(e) => handleElementResizeStart(e, "lowerThird", defaultLtPos)}
                >
                  <Maximize2 className="h-2 w-2 text-slate-950 rotate-90" />
                </div>

                <button 
                  onClick={(e) => { e.stopPropagation(); setShowLowerThirdCropMenu(!showLowerThirdCropMenu); }}
                  className="absolute top-2 right-2 bg-slate-950/85 hover:bg-slate-900 border border-white/20 text-white rounded p-1 text-[8px] flex items-center gap-1 z-50 select-none cursor-pointer no-drag font-bold"
                >
                  <Crop className="h-3 w-3 text-cyan-400" />
                  <span>CẮT</span>
                </button>

                {showLowerThirdCropMenu && (
                  <div className="absolute top-8 right-2 bg-slate-950 border border-cyan-500/40 p-3 rounded-lg shadow-2xl text-white z-55 w-52 no-drag text-left lowercase font-mono">
                    <h5 className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider mb-2 flex items-center justify-between">
                      <span>Cắt Lower Third</span>
                      <button onClick={(e) => { e.stopPropagation(); setShowLowerThirdCropMenu(false); }} className="text-slate-400 hover:text-white">✕</button>
                    </h5>
                    <div className="space-y-2 text-[10px]">
                      {["top", "bottom", "left", "right"].map((side) => (
                        <div key={side}>
                          <div className="flex justify-between mb-0.5 text-slate-400">
                            <span className="capitalize">{side}:</span>
                            <span>{ltCrop[side as "top"|"bottom"|"left"|"right"]}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="90" 
                            value={ltCrop[side as "top"|"bottom"|"left"|"right"]}
                            onChange={(e) => handleElementCropChange("lowerThird", side as any, parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* 7. SCROLLING TICKER MARQUEE */}
      {settings.showTicker && (() => {
        const defaultTickerPos = { x: 0, y: 92, w: 100, h: 8 };
        const tickerPos = settings.tickerPosition || defaultTickerPos;
        const tickerCrop = settings.tickerCrop || { top: 0, bottom: 0, left: 0, right: 0 };
        const hasTickerCrop = tickerCrop.top > 0 || tickerCrop.bottom > 0 || tickerCrop.left > 0 || tickerCrop.right > 0;
        const tickerClipPathStyle = hasTickerCrop 
          ? `inset(${tickerCrop.top}% ${tickerCrop.right}% ${tickerCrop.bottom}% ${tickerCrop.left}%)` 
          : undefined;

        const tickerBgColor = settings.tickerBgColor || "#020617";
        const tickerBgOpacity = settings.tickerBgOpacity ?? 90;

        return (
          <div 
            className={`absolute z-40 text-white font-mono text-xs select-none overflow-hidden flex items-center transition-all duration-75 border-t shadow-lg ${
              isPreview ? "border border-cyan-500/50 hover:border-cyan-400 cursor-move group" : ""
            }`}
            style={{
              left: `${tickerPos.x}%`,
              top: `${tickerPos.y}%`,
              width: `${tickerPos.w}%`,
              height: `${tickerPos.h}%`,
              clipPath: tickerClipPathStyle,
              backgroundColor: getRgbaColor(tickerBgColor, tickerBgOpacity),
              borderTopColor: getRgbaColor("#ffffff", tickerBgOpacity * 0.1),
              borderColor: isPreview ? getRgbaColor("#22d3ee", tickerBgOpacity * 0.5) : undefined,
            }}
            onMouseDown={(e) => handleElementDragStart(e, "ticker", defaultTickerPos)}
          >
            <div 
              className="bg-red-600 text-[10px] text-white px-3.5 py-1 font-bold z-10 flex items-center gap-1 shrink-0 uppercase shadow-lg h-full border-r ml-4 rounded no-drag"
              style={{ borderRightColor: getRgbaColor("#ffffff", tickerBgOpacity * 0.1) }}
            >
              <Volume2 className="h-3.5 w-3.5" />
              <span>TIN MỚI</span>
            </div>
            <div className="flex-1 w-full overflow-hidden whitespace-nowrap flex items-center relative h-full no-drag">
              <div 
                className="inline-block pl-[100%] animate-marquee"
                style={{ 
                  animationDuration: `${settings.tickerSpeed}s`,
                  animationTimingFunction: "linear",
                  animationIterationCount: "infinite"
                }}
              >
                {settings.tickerText}
              </div>
            </div>

            {/* Controls for Preview Mode */}
            {isPreview && (
              <>
                <div 
                  className="absolute bottom-0 right-0 w-4 h-4 bg-cyan-500 cursor-se-resize flex items-center justify-center z-50 hover:bg-cyan-400 no-drag"
                  onMouseDown={(e) => handleElementResizeStart(e, "ticker", defaultTickerPos)}
                >
                  <Maximize2 className="h-2 w-2 text-slate-950 rotate-90" />
                </div>

                <button 
                  onClick={(e) => { e.stopPropagation(); setShowTickerCropMenu(!showTickerCropMenu); }}
                  className="absolute top-1/2 -translate-y-1/2 right-12 bg-slate-950/85 hover:bg-slate-900 border border-white/20 text-white rounded p-1 text-[8px] flex items-center gap-1 z-50 select-none cursor-pointer no-drag font-bold"
                >
                  <Crop className="h-3 w-3 text-cyan-400" />
                  <span>CẮT</span>
                </button>

                {showTickerCropMenu && (
                  <div className="absolute bottom-10 right-12 bg-slate-950 border border-cyan-500/40 p-3 rounded-lg shadow-2xl text-white z-55 w-52 no-drag text-left lowercase font-mono font-bold">
                    <h5 className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider mb-2 flex items-center justify-between">
                      <span>Cắt Chữ Chân Trang</span>
                      <button onClick={(e) => { e.stopPropagation(); setShowTickerCropMenu(false); }} className="text-slate-400 hover:text-white font-bold">✕</button>
                    </h5>
                    <div className="space-y-2 text-[10px]">
                      {["top", "bottom", "left", "right"].map((side) => (
                        <div key={side}>
                          <div className="flex justify-between mb-0.5 text-slate-400">
                            <span className="capitalize">{side}:</span>
                            <span>{tickerCrop[side as "top"|"bottom"|"left"|"right"]}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="90" 
                            value={tickerCrop[side as "top"|"bottom"|"left"|"right"]}
                            onChange={(e) => handleElementCropChange("ticker", side as any, parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Embedded Marquee animation helper in standard Tailwind */}
      <style>{`
        @keyframes marquee {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-100%, 0, 0); }
        }
        .animate-marquee {
          animation-name: marquee;
        }
        @keyframes slide-down {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(0); }
        }
        .animate-slide-down {
          animation: slide-down 0.4s ease-out forwards;
        }
        @keyframes slide-right {
          0% { transform: translateX(-50px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-right {
          animation: slide-right 0.3s ease-out forwards;
        }
        @keyframes slide-up {
          0% { transform: translateY(50px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.4s ease-out forwards;
        }
      `}</style>
      </div>
    </div>
  );
}

/* Dynamic layout coordinates helper in percentage (0-100) */
const getInitialPosition = (index: number, total: number) => {
  if (total <= 1) {
    return { x: 5, y: 5, w: 90, h: 90 };
  }
  if (total <= 2) {
    return index === 0 
      ? { x: 4, y: 15, w: 44, h: 70 } 
      : { x: 52, y: 15, w: 44, h: 70 };
  }
  if (total <= 4) {
    const cols = 2;
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
      x: col === 0 ? 4 : 52,
      y: row === 0 ? 4 : 52,
      w: 44,
      h: 44
    };
  }
  // 5 or more
  const cols = 3;
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    x: col * 31 + 3,
    y: row * 45 + 5,
    w: 28,
    h: 40
  };
};

/* Video Card Sub-Component inside OBS Renderer */
interface VideoCardProps {
  key?: string;
  peerId: string;
  info: PeerStreamInfo;
  settings: StreamSettings;
  isPreview?: boolean;
  onUpdateSettings?: (settings: StreamSettings, isCommit?: boolean) => void;
  index?: number;
  activePeers?: [string, PeerStreamInfo][];
  isSolo?: boolean;
  originalLayout?: string;
}

function ObsVideoCard({ 
  peerId, 
  info, 
  settings, 
  isPreview = false, 
  onUpdateSettings,
  index,
  activePeers,
  isSolo = false,
  originalLayout
}: VideoCardProps) {
  const isHost = info.role === "host";
  
  const rotation = settings.cameraRotations?.[peerId] ?? 0;
  const aspect = settings.cameraAspects?.[peerId] ?? "16:9";
  const fit = settings.cameraFits?.[peerId] ?? "cover";

  const videoClass = fit === "cover" ? "object-cover" : "object-contain";
  const [showCropMenu, setShowCropMenu] = useState(false);
  const [hasNoVideoSignal, setHasNoVideoSignal] = useState(false);

  useEffect(() => {
    const checkSignal = () => {
      const track = info.stream?.getVideoTracks()?.[0];
      const inactive = !info.stream || !track || !track.enabled || track.readyState === "ended";
      setHasNoVideoSignal(inactive);
    };
    checkSignal();
    const interval = setInterval(checkSignal, 1000);
    return () => clearInterval(interval);
  }, [info.stream]);

  // Real-time audio analyzer for speaking levels
  const [volumeLevel, setVolumeLevel] = useState(0); // 0 to 100

  useEffect(() => {
    const stream = info.stream;
    if (!stream || stream.getAudioTracks().length === 0) {
      setVolumeLevel(0);
      return;
    }

    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let animationId: number | null = null;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContext = new AudioContextClass();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength; // 0 to 255
        
        // Map average to a 0-100 scale, with some sensitivity booster
        const mappedVolume = Math.min(100, Math.round((average / 128) * 100));
        setVolumeLevel(mappedVolume);

        animationId = requestAnimationFrame(checkVolume);
      };

      if (audioContext.state === "suspended") {
        const resume = () => {
          audioContext?.resume();
          window.removeEventListener("click", resume);
        };
        window.addEventListener("click", resume);
      }

      checkVolume();
    } catch (err) {
      console.warn("Audio Context Analyzer failed:", err);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (source) {
        source.disconnect();
      }
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(e => console.log("Close AudioContext failed:", e));
      }
    };
  }, [info.stream]);

  // Crop values
  const crop = settings.peerCrops?.[peerId] || { top: 0, bottom: 0, left: 0, right: 0 };
  const hasCrop = crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0;
  const clipPathStyle = (hasCrop && !showCropMenu) 
    ? `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)` 
    : undefined;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Custom positioning, scaling, and drag handling for the individual athlete's score/name badge
  const badgePos = settings.scoreBadgePositions?.[peerId];
  const originalBadgeScale = settings.scoreBadgeScales?.[peerId] ?? 1.0;
  // Scale up the physical size of the badge on the final 1080p stream (OBS link overlay) so that it is readable and matches the dashboard preview proportions
  const badgeScale = originalBadgeScale * (isPreview ? 1.0 : 2.5);
  const badgeStyle: React.CSSProperties = {
    ...(badgePos
      ? {
          left: `${badgePos.x}%`,
          top: `${badgePos.y}%`,
          bottom: "auto",
          right: "auto",
        }
      : {}),
    transform: `scale(${badgeScale})`,
    transformOrigin: badgePos ? "center" : "bottom left",
  };

  const badgeBgOpacity = settings.scoreBadgeBgOpacity ?? 90;

  const handleBadgeResizeStart = (e: React.MouseEvent) => {
    if (!isPreview || !onUpdateSettings) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const currentScales = { ...settingsRef.current.scoreBadgeScales || {} };
    const startScale = currentScales[peerId] || 1.0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // 100 pixels of dragging = 1.0 change in scale
      const nextScale = Math.max(0.4, Math.min(3.0, Math.round((startScale + deltaX * 0.01) * 100) / 100));

      const updatedScales = { ...settingsRef.current.scoreBadgeScales || {} };
      updatedScales[peerId] = nextScale;

      onUpdateSettings({
        ...settingsRef.current,
        scoreBadgeScales: updatedScales,
      }, false);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      onUpdateSettings({ ...settingsRef.current }, true);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleBadgeDragStart = (e: React.MouseEvent) => {
    if (!isPreview || !onUpdateSettings) return;
    const target = e.target as HTMLElement;
    if (target.closest(".no-drag") || target.tagName === "BUTTON") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const badgeElement = e.currentTarget as HTMLElement;
    const parentElement = badgeElement.parentElement;
    if (!parentElement) return;

    const parentRect = parentElement.getBoundingClientRect();
    const badgeRect = badgeElement.getBoundingClientRect();

    const startX = e.clientX;
    const startY = e.clientY;

    const initialX = badgePos
      ? badgePos.x
      : ((badgeRect.left - parentRect.left) / parentRect.width) * 100;
    const initialY = badgePos
      ? badgePos.y
      : ((badgeRect.top - parentRect.top) / parentRect.height) * 100;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const pctDeltaX = (deltaX / parentRect.width) * 100;
      const pctDeltaY = (deltaY / parentRect.height) * 100;

      const badgeWPercent = (badgeRect.width / parentRect.width) * 100;
      const badgeHPercent = (badgeRect.height / parentRect.height) * 100;

      const nextX = Math.max(0, Math.min(100 - badgeWPercent, initialX + pctDeltaX));
      const nextY = Math.max(0, Math.min(100 - badgeHPercent, initialY + pctDeltaY));

      const nextPositions = { ...settingsRef.current.scoreBadgePositions || {} };
      nextPositions[peerId] = {
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10,
      };

      onUpdateSettings({
        ...settingsRef.current,
        scoreBadgePositions: nextPositions,
      }, false);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      const finalPositions = { ...settingsRef.current.scoreBadgePositions || {} };
      onUpdateSettings({
        ...settingsRef.current,
        scoreBadgePositions: finalPositions,
      }, true);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Custom Drag Handlers for Custom Layout
  const handleDragStart = (e: React.MouseEvent) => {
    if (!isPreview || settingsRef.current.layout !== "custom" || !onUpdateSettings || index === undefined || !activePeers) return;
    
    // Do not drag if interactive handles are clicked
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest(".no-drag")) {
      return;
    }
    
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = settingsRef.current.peerPositions?.[peerId] || getInitialPosition(index, activePeers.length);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const container = document.getElementById("obs-participants-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;
      
      const nextX = Math.max(0, Math.min(100 - initialPos.w, initialPos.x + pctDeltaX));
      const nextY = Math.max(0, Math.min(100 - initialPos.h, initialPos.y + pctDeltaY));
      
      const nextPositions = { ...settingsRef.current.peerPositions || {} };
      nextPositions[peerId] = {
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10,
        w: initialPos.w,
        h: initialPos.h
      };
      
      onUpdateSettings({
        ...settingsRef.current,
        peerPositions: nextPositions
      }, false);
    };
    
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      
      // Commit final position to OBS
      const finalPositions = { ...settingsRef.current.peerPositions || {} };
      onUpdateSettings({
        ...settingsRef.current,
        peerPositions: finalPositions
      }, true);
    };
    
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Custom Resize Handlers for Custom Layout
  const handleResizeStart = (e: React.MouseEvent) => {
    if (!isPreview || settingsRef.current.layout !== "custom" || !onUpdateSettings || index === undefined || !activePeers) return;
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = settingsRef.current.peerPositions?.[peerId] || getInitialPosition(index, activePeers.length);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const container = document.getElementById("obs-participants-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;
      
      const nextW = Math.max(10, Math.min(100 - initialPos.x, initialPos.w + pctDeltaX));
      const nextH = Math.max(10, Math.min(100 - initialPos.y, initialPos.h + pctDeltaY));
      
      const nextPositions = { ...settingsRef.current.peerPositions || {} };
      nextPositions[peerId] = {
        x: initialPos.x,
        y: initialPos.y,
        w: Math.round(nextW * 10) / 10,
        h: Math.round(nextH * 10) / 10
      };
      
      onUpdateSettings({
        ...settingsRef.current,
        peerPositions: nextPositions
      }, false);
    };
    
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      
      // Commit final positions to OBS
      const finalPositions = { ...settingsRef.current.peerPositions || {} };
      onUpdateSettings({
        ...settingsRef.current,
        peerPositions: finalPositions
      }, true);
    };
    
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleCropChange = (side: "top" | "bottom" | "left" | "right", val: number) => {
    if (!onUpdateSettings) return;
    const nextCrops = { ...settingsRef.current.peerCrops || {} };
    nextCrops[peerId] = {
      ...crop,
      [side]: val
    };
    onUpdateSettings({
      ...settingsRef.current,
      peerCrops: nextCrops
    });
  };

  const handleEdgeDragStart = (e: React.MouseEvent, edge: "top" | "bottom" | "left" | "right") => {
    if (!isPreview || !onUpdateSettings) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    
    const element = e.currentTarget as HTMLElement;
    const container = element.closest(".video-card-container");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    
    const initialCrop = { ...settingsRef.current.peerCrops?.[peerId] || { top: 0, bottom: 0, left: 0, right: 0 } };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const pctDeltaX = (deltaX / rect.width) * 100;
      const pctDeltaY = (deltaY / rect.height) * 100;
      
      const nextCrops = { ...settingsRef.current.peerCrops || {} };
      
      let newVal = 0;
      if (edge === "top") {
        newVal = Math.max(0, Math.min(80, Math.round((initialCrop.top + pctDeltaY) * 10) / 10));
      } else if (edge === "bottom") {
        newVal = Math.max(0, Math.min(80, Math.round((initialCrop.bottom - pctDeltaY) * 10) / 10));
      } else if (edge === "left") {
        newVal = Math.max(0, Math.min(80, Math.round((initialCrop.left + pctDeltaX) * 10) / 10));
      } else if (edge === "right") {
        newVal = Math.max(0, Math.min(80, Math.round((initialCrop.right - pctDeltaX) * 10) / 10));
      }
      
      nextCrops[peerId] = {
        ...initialCrop,
        [edge]: newVal
      };
      
      onUpdateSettings({
        ...settingsRef.current,
        peerCrops: nextCrops
      }, false);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      
      const finalCrops = { ...settingsRef.current.peerCrops || {} };
      onUpdateSettings({
        ...settingsRef.current,
        peerCrops: finalCrops
      }, true);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const getOverlayPositionClass = () => {
    const currentIdx = index ?? 0;
    const totalCount = activePeers ? activePeers.length : 1;
    const layout = originalLayout || settings.layout;

    if (layout === "custom") {
      const pos = settings.peerPositions?.[peerId] || getInitialPosition(currentIdx, totalCount);
      const isLeft = (pos.x + pos.w / 2) < 50;
      const isTop = (pos.y + pos.h / 2) < 50;

      if (isLeft && isTop) return "bottom-3 right-3";
      if (!isLeft && isTop) return "bottom-3 left-3";
      if (isLeft && !isTop) return "top-3 right-3";
      return "top-3 left-3";
    }

    if (layout === "split" || layout === "side-by-side") {
      if (currentIdx === 0) return "bottom-3 right-3";
      return "bottom-3 left-3";
    }

    if (layout === "grid") {
      if (totalCount <= 2) {
        if (currentIdx === 0) return "bottom-3 right-3";
        return "bottom-3 left-3";
      } else {
        const cols = 2;
        const isLeft = (currentIdx % cols) === 0;
        const isTop = Math.floor(currentIdx / cols) === 0;

        if (isLeft && isTop) return "bottom-3 right-3";
        if (!isLeft && isTop) return "bottom-3 left-3";
        if (isLeft && !isTop) return "top-3 right-3";
        return "top-3 left-3";
      }
    }

    return "bottom-3 right-3";
  };

  const isPip = settings.pipPeers?.[peerId] ?? false;
  
  return (
    <div 
      onMouseDown={handleDragStart}
      style={{ 
        clipPath: clipPathStyle, 
        cursor: isPreview && settings.layout === "custom" ? "move" : "default" 
      }}
      className={`video-card-container ${isPip ? "rounded-full aspect-square" : (isPreview ? "rounded-xl" : "rounded-none")} overflow-hidden relative ${isPreview ? "shadow-2xl border-2" : "border-0 shadow-none"} transition-all duration-150 ${
        volumeLevel > 8 
          ? (isHost ? "border-purple-400 ring-4 ring-purple-500/40 scale-[1.01]" : "border-emerald-400 ring-4 ring-emerald-500/40 scale-[1.01]") 
          : (isPreview ? (isHost ? "border-purple-500/50" : "border-cyan-500/50") : "")
      } group animate-fade-in ${
        settings.layout === "custom" 
          ? "w-full h-full" 
          : (isPip 
              ? "aspect-square max-h-[100%] mx-auto" 
              : (aspect === "9:16" ? "aspect-[9/16] max-h-[100%] mx-auto" : "aspect-video")
            )
      }`}
    >
      {/* Real-time WebRTC Feed playing */}
      <video
        autoPlay
        playsInline
        style={{
          transform: `rotate(${rotation}deg) ${
            info.isMirrored !== undefined
              ? (info.isMirrored ? "scaleX(-1)" : "")
              : (!isHost ? "scaleX(-1)" : "")
          }`
        }}
        className={`w-full h-full transition-all duration-300 ${videoClass}`}
        ref={el => {
          if (el) {
            const isNewAssignment = el.srcObject !== info.stream;
            if (isNewAssignment) {
              el.srcObject = info.stream;
              console.log(`[MEDIA_PIPELINE] [OBS slot video: ${info.name}] srcObject ASSIGNED new stream. readyState: ${el.readyState}`);
            }
            if (el.muted !== isPreview) {
              el.muted = isPreview;
            }
            el.play().catch(e => {
              if (e.name !== "AbortError") {
                console.log("[OBS Play Error]", e);
              }
            });
          }
        }}
      />

      {/* Fallback screen when there is no video signal / camera is off */}
      {hasNoVideoSignal && (
        <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 z-10 transition-all duration-300">
          {isHost ? (
            // For MC / Host
            <div className="flex flex-col items-center justify-center gap-3">
              <img 
                src={settings.logoUrl || "https://lh3.googleusercontent.com/d/1CAz9xUSO8XIvtEy9TYqil228Cz-jYcIM"} 
                referrerPolicy="no-referrer"
                alt="MC Background Logo" 
                className="max-w-[65%] max-h-[65%] object-contain animate-pulse"
              />
              <span className="text-[10px] font-mono tracking-wider text-purple-400 font-bold uppercase">MC OFFLINE</span>
            </div>
          ) : (
            // For Athlete
            <div className="flex flex-col items-center gap-3">
              <div className="h-16 w-16 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 text-cyan-400">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
              </div>
              <span className="text-[10px] font-mono tracking-wider text-cyan-400 font-bold uppercase">VĐV ĐANG KẾT NỐI...</span>
            </div>
          )}
        </div>
      )}

      {/* Floating dynamic Nametag */}
      {!isHost ? (
        <div 
          onMouseDown={handleBadgeDragStart}
          style={{
            ...badgeStyle,
            backgroundColor: `rgba(2, 6, 23, ${badgeBgOpacity / 100})`,
            borderColor: isPreview ? "rgba(34, 211, 238, 0.8)" : `rgba(6, 182, 212, ${(badgeBgOpacity / 100) * 0.4})`,
            ...(!badgePos && (originalLayout || settings.layout) === "custom" ? {
              bottom: `calc(${crop.bottom}% + 12px)`,
              right: `calc(${crop.right}% + 12px)`,
            } : {})
          }}
          className={`absolute ${badgePos ? "" : getOverlayPositionClass()} backdrop-blur-md px-4 py-2 border rounded-xl shadow-2xl flex items-center gap-3 z-10 font-mono select-none animate-fade-in ${
            isPreview ? "cursor-move hover:border-cyan-400" : "border-cyan-500/40"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 pointer-events-none">
            <span className="h-2 w-2 rounded-full bg-cyan-400 shrink-0" />
            <span className="font-bold text-white text-[11px] uppercase tracking-wide truncate max-w-[120px]">
              {settings.scoreNames[peerId] || info.name}
            </span>
            {/* Real-time speech visualizer */}
            {volumeLevel > 2 && (
              <div className="flex items-end gap-[1.5px] h-2.5 w-3.5 pl-1 pointer-events-none shrink-0">
                <span className="w-[1.5px] bg-cyan-400 rounded-t animate-pulse" style={{ height: `${Math.max(20, Math.min(100, volumeLevel * 0.9))}%` }} />
                <span className="w-[1.5px] bg-cyan-400 rounded-t animate-pulse delay-75" style={{ height: `${Math.max(20, Math.min(100, volumeLevel * 1.3))}%` }} />
                <span className="w-[1.5px] bg-cyan-400 rounded-t animate-pulse delay-150" style={{ height: `${Math.max(20, Math.min(100, volumeLevel * 0.6))}%` }} />
              </div>
            )}
          </div>
          {settings.showIndividualScores && (
            <>
              <div className="h-3.5 w-[1px] bg-white/20 shrink-0 pointer-events-none" />
              <div className="flex items-center gap-1 shrink-0 text-amber-400 font-extrabold text-[12px] pointer-events-none">
                <ScoreDisplayWithFireworks score={settings.scores[peerId] || 0} clientId={peerId} className="" />
                <span className="text-[9px] text-slate-400 font-normal">ĐIỂM</span>
              </div>
            </>
          )}
          {isPreview && (
            <div 
              onMouseDown={handleBadgeResizeStart}
              className="absolute bottom-0 right-0 w-3 h-3 bg-cyan-500 rounded-tl cursor-se-resize flex items-center justify-center z-20 hover:bg-cyan-400 no-drag"
              title="Kéo ở đây để chỉnh kích thước bảng điểm"
            >
              <Maximize2 className="h-1.5 w-1.5 text-slate-950 rotate-90" />
            </div>
          )}
        </div>
      ) : (
        <div 
          style={{
            backgroundColor: `rgba(2, 6, 23, ${badgeBgOpacity / 100})`,
            borderColor: `rgba(255, 255, 255, ${(badgeBgOpacity / 100) * 0.1})`,
            bottom: `calc(${crop.bottom}% + 12px)`,
            left: `calc(${crop.left}% + 12px)`,
          }}
          className="absolute backdrop-blur-md px-3 py-1 border rounded-lg text-[11px] font-mono font-bold text-white tracking-wide uppercase flex items-center gap-1.5 z-10 shadow-lg select-none"
        >
          <span className={`h-2 w-2 rounded-full ${isHost ? "bg-purple-400" : "bg-cyan-400"}`} />
          <span>{info.name}</span>
          <span className="text-[9px] text-slate-400 font-normal">
            {isHost ? "MC" : "VĐV"}
          </span>
          {/* Real-time speech visualizer */}
          {volumeLevel > 2 && (
            <div className="flex items-end gap-[1.5px] h-2.5 w-3.5 pl-1 pointer-events-none shrink-0">
              <span className={`w-[1.5px] rounded-t animate-pulse ${isHost ? "bg-purple-400" : "bg-cyan-400"}`} style={{ height: `${Math.max(20, Math.min(100, volumeLevel * 0.9))}%` }} />
              <span className={`w-[1.5px] rounded-t animate-pulse delay-75 ${isHost ? "bg-purple-400" : "bg-cyan-400"}`} style={{ height: `${Math.max(20, Math.min(100, volumeLevel * 1.3))}%` }} />
              <span className={`w-[1.5px] rounded-t animate-pulse delay-150 ${isHost ? "bg-purple-400" : "bg-cyan-400"}`} style={{ height: `${Math.max(20, Math.min(100, volumeLevel * 0.6))}%` }} />
            </div>
          )}
        </div>
      )}

      {/* INTERACTIVE OVERLAYS FOR CUSTOM LAYOUT PREVIEW */}
      {isPreview && settings.layout === "custom" && (
        <>
          {/* Top Hover Menu */}
          <div 
            style={{
              top: `calc(${crop.top}% + 8px)`,
              right: `calc(${crop.right}% + 8px)`
            }}
            className="absolute opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex gap-1 z-20 no-drag"
          >
            <button
              onClick={() => setShowCropMenu(!showCropMenu)}
              title="Cắt xén khung hình (Crop)"
              className="bg-black/80 hover:bg-cyan-600 border border-white/10 hover:border-cyan-400 p-1.5 rounded-lg text-white hover:text-black transition-all cursor-pointer shadow-lg"
            >
              <Scissors className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Quick instructions indicator overlay */}
          <div className="absolute inset-0 bg-cyan-400/5 pointer-events-none border border-cyan-400/20 group-hover:border-cyan-400/60 rounded-xl transition-all" />

          {/* Bottom-right Corner Resize Handle */}
          <div 
            onMouseDown={handleResizeStart}
            title="Kéo để thay đổi kích thước"
            style={{
              bottom: `calc(${crop.bottom}% + 4px)`,
              right: `calc(${crop.right}% + 4px)`
            }}
            className="absolute w-5 h-5 bg-cyan-400 hover:bg-cyan-300 border border-black/20 rounded-tl-lg cursor-se-resize flex items-center justify-center shadow-lg z-20 no-drag active:scale-95 transition-all"
          >
            <Maximize2 className="h-2.5 w-2.5 text-black" />
          </div>
        </>
      )}

      {/* Visual Crop Masks (only shown during active Crop mode) */}
      {isPreview && settings.layout === "custom" && showCropMenu && (
        <>
          {/* Top Mask */}
          <div 
            style={{ height: `${crop.top}%` }} 
            className="absolute top-0 left-0 right-0 bg-black/10 z-20 pointer-events-none" 
          />
          {/* Bottom Mask */}
          <div 
            style={{ height: `${crop.bottom}%` }} 
            className="absolute bottom-0 left-0 right-0 bg-black/10 z-20 pointer-events-none" 
          />
          {/* Left Mask */}
          <div 
            style={{ 
              left: 0, 
              top: `${crop.top}%`, 
              bottom: `${crop.bottom}%`, 
              width: `${crop.left}%` 
            }} 
            className="absolute bg-black/10 z-20 pointer-events-none" 
          />
          {/* Right Mask */}
          <div 
            style={{ 
              right: 0, 
              top: `${crop.top}%`, 
              bottom: `${crop.bottom}%`, 
              width: `${crop.right}%` 
            }} 
            className="absolute bg-black/10 z-20 pointer-events-none" 
          />

          {/* Glowing Outline of View Area */}
          <div 
            style={{
              left: `${crop.left}%`,
              right: `${crop.right}%`,
              top: `${crop.top}%`,
              bottom: `${crop.bottom}%`,
            }}
            className="absolute border-2 border-dashed border-cyan-400 z-25 pointer-events-none shadow-[0_0_15px_rgba(34,211,238,0.4)]"
          >
            <div className="absolute top-2 left-2 bg-cyan-500/90 text-slate-950 text-[8px] font-black font-mono px-1.5 py-0.5 rounded shadow pointer-events-none uppercase">
              VÙNG HIỂN THỊ CẮT XÉN
            </div>
          </div>

          {/* DRAGGABLE EDGE HANDLES - VISUALLY PLACED ON CROPPED EDGES */}
          <div 
            style={{
              left: `calc(${crop.left}% + 10%)`,
              width: "80%",
              top: `calc(${crop.top}% - 8px)`,
            }}
            onMouseDown={(e) => handleEdgeDragStart(e, "top")}
            className="absolute h-5 cursor-ns-resize z-30 no-drag flex items-center justify-center group"
            title="Kéo cạnh Trên để cắt"
          >
            <div className="w-24 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.9)] border border-white/30 transition-all group-hover:scale-y-150 group-hover:bg-cyan-300" />
          </div>

          <div 
            style={{
              left: `calc(${crop.left}% + 10%)`,
              width: "80%",
              top: `calc(100% - ${crop.bottom}% - 12px)`,
            }}
            onMouseDown={(e) => handleEdgeDragStart(e, "bottom")}
            className="absolute h-5 cursor-ns-resize z-30 no-drag flex items-center justify-center group"
            title="Kéo cạnh Dưới để cắt"
          >
            <div className="w-24 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.9)] border border-white/30 transition-all group-hover:scale-y-150 group-hover:bg-cyan-300" />
          </div>

          <div 
            style={{
              left: `calc(${crop.left}% - 8px)`,
              top: `calc(${crop.top}% + 10%)`,
              height: "80%",
            }}
            onMouseDown={(e) => handleEdgeDragStart(e, "left")}
            className="absolute w-5 cursor-ew-resize z-30 no-drag flex items-center justify-center group"
            title="Kéo cạnh Trái để cắt"
          >
            <div className="h-24 w-1.5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.9)] border border-white/30 transition-all group-hover:scale-x-150 group-hover:bg-cyan-300" />
          </div>

          <div 
            style={{
              left: `calc(100% - ${crop.right}% - 12px)`,
              top: `calc(${crop.top}% + 10%)`,
              height: "80%",
            }}
            onMouseDown={(e) => handleEdgeDragStart(e, "right")}
            className="absolute w-5 cursor-ew-resize z-30 no-drag flex items-center justify-center group"
            title="Kéo cạnh Phải để cắt"
          >
            <div className="h-24 w-1.5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.9)] border border-white/30 transition-all group-hover:scale-x-150 group-hover:bg-cyan-300" />
          </div>
        </>
      )}

      {/* CROP OVERLAY CONTROLS FLOATING COMPACT PANEL */}
      {isPreview && settings.layout === "custom" && showCropMenu && (
        <div className="absolute bottom-2 left-2 right-2 bg-slate-950/10 p-3.5 rounded-xl border border-cyan-500/40 flex flex-col gap-2.5 z-45 no-drag shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
            <span className="text-[10px] font-mono font-bold text-cyan-400 flex items-center gap-1">
              <Scissors className="h-3 w-3" />
              <span>XÉN THỦ CÔNG: DI CHUYỂN 4 CẠNH CYAN HOẶC CO KÉO SLIDER</span>
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-2.5 text-[9px] font-mono text-slate-300">
            {/* Top Crop */}
            <div className="flex items-center justify-between gap-2 bg-black/40 px-2 py-1.5 rounded border border-white/5">
              <span className="text-slate-400 font-bold">⬆️ TRÊN:</span>
              <input 
                type="range" 
                min="0" 
                max="80" 
                value={crop.top} 
                onChange={(e) => handleCropChange("top", parseInt(e.target.value))}
                className="flex-1 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-cyan-400"
              />
              <span className="w-8 text-right font-bold text-cyan-400">{crop.top}%</span>
            </div>

            {/* Bottom Crop */}
            <div className="flex items-center justify-between gap-2 bg-black/40 px-2 py-1.5 rounded border border-white/5">
              <span className="text-slate-400 font-bold">⬇️ DƯỚI:</span>
              <input 
                type="range" 
                min="0" 
                max="80" 
                value={crop.bottom} 
                onChange={(e) => handleCropChange("bottom", parseInt(e.target.value))}
                className="flex-1 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-cyan-400"
              />
              <span className="w-8 text-right font-bold text-cyan-400">{crop.bottom}%</span>
            </div>

            {/* Left Crop */}
            <div className="flex items-center justify-between gap-2 bg-black/40 px-2 py-1.5 rounded border border-white/5">
              <span className="text-slate-400 font-bold">⬅️ TRÁI:</span>
              <input 
                type="range" 
                min="0" 
                max="80" 
                value={crop.left} 
                onChange={(e) => handleCropChange("left", parseInt(e.target.value))}
                className="flex-1 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-cyan-400"
              />
              <span className="w-8 text-right font-bold text-cyan-400">{crop.left}%</span>
            </div>

            {/* Right Crop */}
            <div className="flex items-center justify-between gap-2 bg-black/40 px-2 py-1.5 rounded border border-white/5">
              <span className="text-slate-400 font-bold">➡️ PHẢI:</span>
              <input 
                type="range" 
                min="0" 
                max="80" 
                value={crop.right} 
                onChange={(e) => handleCropChange("right", parseInt(e.target.value))}
                className="flex-1 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-cyan-400"
              />
              <span className="w-8 text-right font-bold text-cyan-400">{crop.right}%</span>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!onUpdateSettings) return;
                const nextCrops = { ...settings.peerCrops || {} };
                nextCrops[peerId] = { top: 0, bottom: 0, left: 0, right: 0 };
                onUpdateSettings({
                  ...settings,
                  peerCrops: nextCrops
                });
              }}
              className="flex-1 bg-slate-900 hover:bg-slate-800 text-[9px] py-1.5 rounded border border-white/5 font-bold transition-all cursor-pointer text-rose-400 hover:text-rose-300"
            >
              HỦY XÉN
            </button>
            <button 
              onClick={() => setShowCropMenu(false)}
              className="flex-1 text-[9px] bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-1.5 rounded font-black cursor-pointer transition-all duration-150 shadow text-center"
            >
              HOÀN THÀNH
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

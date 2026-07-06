import React, { useState } from "react";
import { Tv, Users, Monitor, Video, ArrowRight, Shield, Settings, Info, ExternalLink } from "lucide-react";

interface PortalWelcomeProps {
  onJoin: (params: { role: "host" | "athlete" | "obs"; roomId: string; name?: string }) => void;
}

export function PortalWelcome({ onJoin }: PortalWelcomeProps) {
  const [hostRoomId, setHostRoomId] = useState(() => Math.random().toString(36).substring(2, 8).toUpperCase());
  const [mcName, setMcName] = useState("MC Ban Tổ Chức");
  
  const [athleteRoomId, setAthleteRoomId] = useState("");
  const [athleteName, setAthleteName] = useState("");
  const [athleteError, setAthleteError] = useState("");

  const [obsRoomId, setObsRoomId] = useState("");
  const [obsError, setObsError] = useState("");

  const handleHostSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostRoomId.trim()) return;
    onJoin({ role: "host", roomId: hostRoomId.trim().toUpperCase(), name: mcName });
  };

  const handleAthleteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!athleteRoomId.trim()) {
      setAthleteError("Vui lòng nhập Mã Phòng.");
      return;
    }
    if (!athleteName.trim()) {
      setAthleteError("Vui lòng nhập tên Vận Động Viên.");
      return;
    }
    setAthleteError("");
    onJoin({ role: "athlete", roomId: athleteRoomId.trim().toUpperCase(), name: athleteName.trim() });
  };

  const handleObsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!obsRoomId.trim()) {
      setObsError("Vui lòng nhập Mã Phòng.");
      return;
    }
    setObsError("");
    onJoin({ role: "obs", roomId: obsRoomId.trim().toUpperCase() });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-6 font-sans selection:bg-emerald-500 selection:text-black">
      {/* Upper Tech Accents */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-blue-600 to-emerald-500" />
      
      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Header */}
      <header className="relative max-w-7xl mx-auto w-full flex items-center justify-between py-4 border-b border-slate-900 z-10">
        <div className="flex items-center gap-3">
          <div className="p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center shadow-lg shadow-emerald-500/5">
            <img 
              src="https://lh3.googleusercontent.com/d/1CAz9xUSO8XIvtEy9TYqil228Cz-jYcIM" 
              referrerPolicy="no-referrer"
              alt="Brand Logo" 
              className="h-9 w-auto object-contain"
            />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white uppercase font-mono">VSC Broadcast Studio</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Dynamic Production Suite</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-slate-300 font-mono">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>v2.0 VSC CLOUD SOURCE</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative max-w-6xl mx-auto w-full my-auto py-12 z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: Introduction & Diagram */}
        <div className="lg:col-span-5 space-y-6">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-medium">
            <Shield className="h-3 w-3" />
            <span>Mô hình kết nối đám mây an toàn</span>
          </div>
          
          <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-white leading-[1.1] font-mono">
            KÊNH TRUYỀN HÌNH <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
              ĐA ĐIỂM CHUYÊN NGHIỆP
            </span>
          </h2>

          <p className="text-slate-400 text-sm leading-relaxed max-w-md">
            Hệ thống sản xuất nội dung tương tác trực tiếp (vMix/StreamYard-like). MC điều khiển từ xa, các vận động viên tham gia thi đấu từ xa, và VSC trích xuất toàn bộ giao diện đồ họa, chữ chạy, bảng điểm động thời gian thực với chất lượng HD 1080p 60fps.
          </p>

          {/* Diagram Info Box */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 p-4 rounded-xl space-y-3 text-xs">
            <span className="font-mono text-emerald-400 block font-bold uppercase tracking-wider">Hệ thống luồng hoạt động:</span>
            <div className="flex flex-col gap-2 font-mono text-slate-400">
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded flex items-center justify-center font-bold">1</span>
                <span>Vận động viên kết nối Webcam/Mic không trễ</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded flex items-center justify-center font-bold">2</span>
                <span>MC điều phối bố cục, tính điểm số trực tiếp</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded flex items-center justify-center font-bold">3</span>
                <span>VSC import Link Trình Duyệt để Phát Sóng</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Roles Panels */}
        <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Card 1: HOST (MC/Director) */}
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 hover:border-emerald-500/30 transition-all duration-300 p-6 rounded-2xl flex flex-col justify-between space-y-6">
            <div className="space-y-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-mono">1. MC BAN TỔ CHỨC</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Làm chủ phòng đấu. Nói trực tiếp, điều chỉnh bố cục camera, thay đổi nội dung chữ chạy, cập nhật điểm số và hiệu ứng vinh danh.
                </p>
              </div>
            </div>

            <form onSubmit={handleHostSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-400 font-mono uppercase tracking-wider mb-1">Mã Phòng Tạo Mới</label>
                <input
                  type="text"
                  value={hostRoomId}
                  onChange={(e) => setHostRoomId(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-white font-mono uppercase tracking-widest outline-none"
                  placeholder="MÃ PHÒNG"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 font-mono uppercase tracking-wider mb-1">Tên Hiển Thị Của MC</label>
                <input
                  type="text"
                  value={mcName}
                  onChange={(e) => setMcName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-white outline-none"
                  placeholder="Tên MC / Bình luận viên"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition-all text-slate-950 font-bold py-2 px-4 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer font-mono"
              >
                <span>MỞ STUDIO BAN TỔ CHỨC</span>
                <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
              </button>
            </form>
          </div>

          {/* Card 2: ATHLETE (Vận động viên) */}
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 hover:border-cyan-500/30 transition-all duration-300 p-6 rounded-2xl flex flex-col justify-between space-y-6">
            <div className="space-y-3">
              <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-mono">2. VẬN ĐỘNG VIÊN</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Gia nhập phòng thi đấu bằng điện thoại hoặc laptop. Kết nối Camera và Microphone trực tiếp tới Studio để MC đưa lên sóng.
                </p>
              </div>
            </div>

            <form onSubmit={handleAthleteSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-400 font-mono uppercase tracking-wider mb-1">Mã Phòng Gia Nhập</label>
                <input
                  type="text"
                  value={athleteRoomId}
                  onChange={(e) => setAthleteRoomId(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm text-white font-mono uppercase tracking-widest outline-none"
                  placeholder="VÍ DỤ: AXCDFE"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 font-mono uppercase tracking-wider mb-1">Tên Vận Động Viên</label>
                <input
                  type="text"
                  value={athleteName}
                  onChange={(e) => setAthleteName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm text-white outline-none"
                  placeholder="Họ tên của VĐV..."
                />
              </div>
              {athleteError && <p className="text-[11px] text-rose-400">{athleteError}</p>}
              <button
                type="submit"
                className="w-full bg-cyan-500 hover:bg-cyan-600 active:scale-95 transition-all text-slate-950 font-bold py-2 px-4 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer font-mono"
              >
                <span>GIA NHẬP PHÒNG ĐẤU</span>
                <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
              </button>
            </form>
          </div>

          {/* Card 3: VSC BROWSER SOURCE OVERLAY (Full block below) */}
          <div className="md:col-span-2 bg-slate-900/40 backdrop-blur-md border border-slate-800 hover:border-purple-500/30 transition-all duration-300 p-6 rounded-2xl flex flex-col md:flex-row items-center gap-6">
            <div className="md:w-3/5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <Monitor className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white font-mono">3. ĐẦU RA VSC BROWSER OVERLAY</h3>
                  <p className="text-xs text-purple-400 font-medium">Bố cục đồ họa siêu sắc nét - Trong suốt - Real-time</p>
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Copy liên kết này dán vào <strong>Browser Source</strong> của OBS Studio. Toàn bộ thiết kế chữ chạy, logo động, tỉ số, khung camera của MC và VĐV sẽ được kết hợp đồng bộ và hiển thị mượt mà trên nền trong suốt chất lượng cao, phục vụ ghi hình phát sóng.
              </p>
            </div>

            <form onSubmit={handleObsSubmit} className="md:w-2/5 w-full space-y-3">
              <div>
                <label className="block text-[10px] text-slate-400 font-mono uppercase tracking-wider mb-1">Mã Phòng Truy Xuất</label>
                <input
                  type="text"
                  value={obsRoomId}
                  onChange={(e) => setObsRoomId(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-white font-mono uppercase tracking-widest outline-none"
                  placeholder="MÃ PHÒNG ĐANG CHẠY"
                />
              </div>
              {obsError && <p className="text-[11px] text-rose-400">{obsError}</p>}
              <button
                type="submit"
                className="w-full bg-purple-500 hover:bg-purple-600 active:scale-95 transition-all text-white font-bold py-2.5 px-4 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer font-mono"
              >
                <span>XEM GIAO DIỆN BROWSER OVERLAY</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="relative max-w-7xl mx-auto w-full py-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 font-mono z-10">
        <span>© 2026 VSC LIVE STREAM INGESTION SYSTEM</span>
        <div className="flex gap-4">
          <span className="hover:text-slate-300 transition-colors">Tải mã nguồn</span>
          <span className="hover:text-slate-300 transition-colors">Hướng dẫn OBS Studio</span>
          <span className="hover:text-slate-300 transition-colors">Chính sách bảo mật</span>
        </div>
      </footer>
    </div>
  );
}

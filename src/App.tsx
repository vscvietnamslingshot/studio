import React, { useState, useEffect } from "react";
import { PortalWelcome } from "./components/PortalWelcome";
import { HostDashboard } from "./components/HostDashboard";
import { AthleteView } from "./components/AthleteView";
import { ObsRenderer } from "./components/ObsRenderer";

export default function App() {
  const [role, setRole] = useState<"host" | "athlete" | "obs" | "portal">("portal");
  const [roomId, setRoomId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [athleteId, setAthleteId] = useState<string>("");

  // Parse URL queries on mount to enable persistent deep linking (essential for OBS browser sources!)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get("role") as "host" | "athlete" | "obs" | null;
    const roomParam = params.get("roomId");
    const nameParam = params.get("name") || "";
    const athleteIdParam = params.get("athleteId") || params.get("id") || "";

    if (roleParam && roomParam) {
      setRole(roleParam);
      setRoomId(roomParam.toUpperCase());
      setName(nameParam);
      setAthleteId(athleteIdParam);
    }
  }, []);

  // Update URL history to keep links shareable and direct
  const handleJoin = (params: { role: "host" | "athlete" | "obs"; roomId: string; name?: string; athleteId?: string }) => {
    const nextRoomId = params.roomId.toUpperCase();
    const nextName = params.name || "";
    const nextAthleteId = params.athleteId || "";
    
    setRole(params.role);
    setRoomId(nextRoomId);
    setName(nextName);
    setAthleteId(nextAthleteId);

    // Update query parameters in the address bar without page reload
    const url = new URL(window.location.href);
    url.searchParams.set("role", params.role);
    url.searchParams.set("roomId", nextRoomId);
    if (nextName) {
      url.searchParams.set("name", nextName);
    } else {
      url.searchParams.delete("name");
    }
    if (nextAthleteId) {
      url.searchParams.set("athleteId", nextAthleteId);
    } else {
      url.searchParams.delete("athleteId");
    }
    window.history.pushState({}, "", url.toString());
  };

  // Clear query parameters when leaving a room/studio and return to Portal Welcome
  const handleLeave = () => {
    setRole("portal");
    setRoomId("");
    setName("");
    setAthleteId("");

    // Clear queries in URL address bar
    const url = new URL(window.location.href);
    url.search = "";
    window.history.pushState({}, "", url.toString());
  };

  // Render correct sub-view
  switch (role) {
    case "host":
      return (
        <HostDashboard
          roomId={roomId}
          initialMcName={name}
          onLeave={handleLeave}
        />
      );

    case "athlete":
      return (
        <AthleteView
          roomId={roomId}
          initialName={name}
          athleteId={athleteId}
          onLeave={handleLeave}
        />
      );

    case "obs":
      return (
        <ObsRenderer
          roomId={roomId}
        />
      );

    case "portal":
    default:
      return (
        <PortalWelcome
          onJoin={handleJoin}
        />
      );
  }
}

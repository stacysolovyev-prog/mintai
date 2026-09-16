"use client";

import { useState } from "react";
import Tutor from "@/components/Tutor";
import ScanTab from "@/components/ScanTab";
import VoiceTab from "@/components/VoiceTab";
import StudyTab from "@/components/StudyTab";
import ProfileTab from "@/components/ProfileTab";
import Wordmark from "@/components/Wordmark";
import SetupBanner from "@/components/SetupBanner";
import { ScanIcon, ChatIcon, VoiceIcon, StudyIcon, YouIcon } from "@/components/Icons";
import { useAuth } from "@/lib/useAuth";
import { haptic } from "@/lib/haptics";

const TABS = [
  { id: "scan",  label: "Scan",  sub: "Photo of the problem", Icon: ScanIcon },
  { id: "chat",  label: "Chat",  sub: "Type it out",          Icon: ChatIcon },
  { id: "voice", label: "Voice", sub: "Talk it through",      Icon: VoiceIcon },
  { id: "study", label: "Study", sub: "To-do, cards, class",  Icon: StudyIcon },
  { id: "you",   label: "You",   sub: "Profile and stats",    Icon: YouIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Page() {
  const [tab, setTab] = useState<TabId>("scan");
  const { user, profile, ready, refreshProfile, signOut, cloudEnabled } = useAuth();
  const userId = user?.id ?? null;

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="app">
      <header className="topbar">
        <div className="grow col" style={{ gap: 3 }}>
          <Wordmark size={21} />
          <span className="sub">{current.sub}</span>
        </div>
      </header>

      <main className="main">
        <SetupBanner />
        {!ready && cloudEnabled ? (
          <div className="empty">
            <span className="spin dark" style={{ margin: "0 auto" }} />
          </div>
        ) : (
          <>
            {tab === "scan" && <ScanTab userId={userId} />}
            {tab === "chat" && (
              <Tutor source="chat" userId={userId} placeholder="What are you stuck on?" />
            )}
            {tab === "voice" && <VoiceTab userId={userId} />}
            {tab === "study" && <StudyTab userId={userId} />}
            {tab === "you" && (
              <ProfileTab
                user={user}
                profile={profile}
                cloudEnabled={cloudEnabled}
                onProfileChange={refreshProfile}
                onSignOut={signOut}
              />
            )}
          </>
        )}
      </main>

      <nav className="tabbar">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "on" : ""}
            onClick={() => {
              if (id !== tab) haptic("tap");
              setTab(id);
            }}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

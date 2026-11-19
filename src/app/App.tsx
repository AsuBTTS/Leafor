import { useEffect, useState } from "react";
import { HashRouter, Route, Routes, useNavigate } from "react-router-dom";
import { repo, backend, isDesktop } from "./backend";
import { useRepo, toast } from "./store";
import { IconRail } from "@/components/navigation/Chrome";
import { BusyOverlay, DialogHost, Toasts } from "@/components/feedback/Overlays";
import { WelcomePage } from "@/features/welcome/WelcomePage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { CollectionsPage } from "@/features/collections/CollectionsPage";
import { SearchPage } from "@/features/search/SearchPage";
import { MarksPage } from "@/features/tags-status/MarksPage";
import { ArchivePage } from "@/features/trash/ArchivePage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { ItemPage } from "@/features/library/ItemPage";
import { RecoveryBanner } from "@/features/welcome/RecoveryBanner";
import { anyDirty, checkAllExternal, flushAll } from "@/services/content/editSessions";
import { searchIndex } from "@/services/search/searchIndex";
import { seedDemoWorkspace } from "@/services/library/demoSeed";

function Shell() {
  const r = useRepo();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // Detect external changes when the window regains focus (technical design §7.3, §12.3).
  useEffect(() => {
    let last = 0;
    const onFocus = async () => {
      if (!repo.isOpen || Date.now() - last < 1500) return;
      last = Date.now();
      try {
        await repo.flushWrites();
        await repo.loadWorkspace();
        await checkAllExternal();
        searchIndex.scheduleRebuild();
      } catch (e) {
        console.warn("reload failed", e);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  if (!r.isOpen) return <WelcomePage />;

  return (
    <div className="lf-app">
      <IconRail />
      <main className="lf-main">
        <RecoveryBanner />
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/marks" element={<MarksPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/item/:itemId" element={<ItemPage />} />
          <Route path="/item/:itemId/:unitId" element={<ItemPage />} />
          <Route path="*" element={<LibraryPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!isDesktop) {
          await seedDemoWorkspace(repo, "/demo/示例作品库");
        } else {
          const recent = await backend.platform.recentList();
          if (recent[0]) {
            try {
              await repo.openWorkspace(recent[0].path);
            } catch (e) {
              console.warn("could not reopen last workspace", e);
            }
          }
        }
        if (repo.isOpen) {
          searchIndex.scheduleRebuild(0);
          if (repo.loadIssues.length) toast.warning(`有 ${repo.loadIssues.length} 个元数据文件无法读取，已跳过（原文件未改动）。`);
        }
      } finally {
        setBooted(true);
      }
    })();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (anyDirty()) {
        void flushAll();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  if (!booted) return <div className="lf-boot" />;
  return (
    <HashRouter>
      <Shell />
      <DialogHost />
      <Toasts />
      <BusyOverlay />
    </HashRouter>
  );
}

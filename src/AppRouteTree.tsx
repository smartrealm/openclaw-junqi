import { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { FeatureRoute } from '@/components/FeatureRoute';

const AppLayout = lazy(() => import('@/components/Layout/AppLayout').then(m => ({ default: m.AppLayout })));
const DashboardPage = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const ChatPage = lazy(() => import('@/pages/ChatPage').then(m => ({ default: m.ChatPage })));
const QuickChatPage = lazy(() => import('@/pages/QuickChatPage').then(m => ({ default: m.QuickChatPage })));
const WorkshopPage = lazy(() => import('@/pages/Workshop').then(m => ({ default: m.WorkshopPage })));
const FullAnalyticsPage = lazy(() => import('@/pages/FullAnalytics').then(m => ({ default: m.FullAnalyticsPage })));
const CronMonitorPage = lazy(() => import('@/pages/CronMonitor').then(m => ({ default: m.CronMonitorPage })));
const AgentHubPage = lazy(() => import('@/pages/AgentHub').then(m => ({ default: m.AgentHubPage })));
const ChannelsCenterPage = lazy(() => import('@/pages/ChannelsCenter').then(m => ({ default: m.ChannelsCenterPage })));
const MemoryExplorerPage = lazy(() => import('@/pages/MemoryExplorer').then(m => ({ default: m.MemoryExplorerPage })));
const SkillsPageFull = lazy(() => import('@/pages/SkillsPage').then(m => ({ default: m.SkillsPage })));
const SkillHubManagerPage = lazy(() => import('@/pages/SkillHubManager').then(m => ({ default: m.SkillHubManager })));
const TimelinePage = lazy(() => import('@/pages/TimelinePage').then(m => ({ default: m.TimelinePage })));
const WelcomePageView = lazy(() => import('@/pages/WelcomePageView').then(m => ({ default: m.default })));
const AgentRunView = lazy(() => import('@/pages/AgentRunView').then(m => ({ default: m.default })));
const AgentWorkspacePage = lazy(() => import('@/pages/AgentWorkspace').then(m => ({ default: m.AgentWorkspacePage })));
const SessionViewPage = lazy(() => import('@/pages/SessionViewPage').then(m => ({ default: m.default })));
const TerminalPage = lazy(() => import('@/pages/TerminalPage').then(m => ({ default: m.TerminalPage })));
const SettingsPageFull = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPageFull })));
const ConfigManagerPage = lazy(() => import('@/pages/ConfigManager').then(m => ({ default: m.ConfigManagerPage })));
const SessionManagerPage = lazy(() => import('@/pages/SessionManager').then(m => ({ default: m.SessionManagerPage })));
const LogsViewerPage = lazy(() => import('@/pages/LogsViewer').then(m => ({ default: m.LogsViewerPage })));
const MultiAgentViewPage = lazy(() => import('@/pages/MultiAgentView').then(m => ({ default: m.MultiAgentViewPage })));
const FileManagerPage = lazy(() => import('@/pages/FileManager').then(m => ({ default: m.FileManagerPage })));
const CalendarPage = lazy(() => import('@/pages/Calendar'));
const CodeInterpreterPage = lazy(() => import('@/pages/CodeInterpreter').then(m => ({ default: m.CodeInterpreterPage })));
const McpToolsPage = lazy(() => import('@/pages/McpTools').then(m => ({ default: m.McpToolsPage })));
const PerformancePage = lazy(() => import('@/pages/Performance').then(m => ({ default: m.Performance })));
const KanbanPage = lazy(() => import('@/pages/Kanban').then(m => ({ default: m.Kanban })));
const GitPage = lazy(() => import('@/pages/GitPage'));
const UIShowcase = lazy(() => import('@/pages/UIShowcase'));

export default function AppRouteTree() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<FeatureRoute feature="dashboard"><DashboardPage /></FeatureRoute>} />
        <Route path="/chat" element={<FeatureRoute feature="chat"><ChatPage /></FeatureRoute>} />
        <Route path="/quickchat" element={<QuickChatPage />} />
        <Route path="/workshop" element={<FeatureRoute feature="workshop"><WorkshopPage /></FeatureRoute>} />
        <Route path="/analytics" element={<FeatureRoute feature="analytics"><FullAnalyticsPage /></FeatureRoute>} />
        <Route path="/cron" element={<FeatureRoute feature="cron"><CronMonitorPage /></FeatureRoute>} />
        <Route path="/agents" element={<FeatureRoute feature="agents"><AgentHubPage /></FeatureRoute>} />
        <Route path="/channels" element={<FeatureRoute feature="configManager"><ChannelsCenterPage /></FeatureRoute>} />
        <Route path="/skills" element={<FeatureRoute feature="skills"><SkillsPageFull /></FeatureRoute>} />
        <Route path="/skill-hub" element={<FeatureRoute feature="skills"><SkillHubManagerPage /></FeatureRoute>} />
        <Route path="/timeline" element={<FeatureRoute feature="workshop"><TimelinePage /></FeatureRoute>} />
        <Route path="/welcome" element={<FeatureRoute feature="dashboard"><WelcomePageView /></FeatureRoute>} />
        <Route path="/agent-run" element={<FeatureRoute feature="agentRun"><AgentRunView /></FeatureRoute>} />
        <Route path="/ai-workspace" element={<FeatureRoute feature="agentRun"><AgentWorkspacePage /></FeatureRoute>} />
        <Route path="/session" element={<FeatureRoute feature="dashboard"><SessionViewPage /></FeatureRoute>} />
        <Route path="/terminal" element={<FeatureRoute feature="terminal"><TerminalPage /></FeatureRoute>} />
        <Route path="/memory" element={<FeatureRoute feature="memory"><MemoryExplorerPage /></FeatureRoute>} />
        <Route path="/config" element={<FeatureRoute feature="configManager"><ConfigManagerPage /></FeatureRoute>} />
        <Route path="/sessions" element={<FeatureRoute feature="sessions"><SessionManagerPage /></FeatureRoute>} />
        <Route path="/logs" element={<FeatureRoute feature="logs"><LogsViewerPage /></FeatureRoute>} />
        <Route path="/agents/live" element={<FeatureRoute feature="liveAgents"><MultiAgentViewPage /></FeatureRoute>} />
        <Route path="/files" element={<FeatureRoute feature="files"><FileManagerPage /></FeatureRoute>} />
        <Route path="/git" element={<FeatureRoute feature="git"><GitPage /></FeatureRoute>} />
        <Route path="/calendar" element={<FeatureRoute feature="calendar"><CalendarPage /></FeatureRoute>} />
        <Route path="/sandbox" element={<FeatureRoute feature="sandbox"><CodeInterpreterPage /></FeatureRoute>} />
        <Route path="/tools" element={<FeatureRoute feature="tools"><McpToolsPage /></FeatureRoute>} />
        <Route path="/perf" element={<PerformancePage />} />
        <Route path="/kanban" element={<KanbanPage />} />
        <Route path="/ui-showcase" element={<UIShowcase />} />
        <Route path="/settings" element={<FeatureRoute feature="settings"><SettingsPageFull /></FeatureRoute>} />
      </Route>
    </Routes>
  );
}

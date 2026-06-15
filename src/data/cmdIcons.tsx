// Icon resolver for slash commands — string → Lucide component.
// Kept separate from MessageInput.tsx to avoid bloat.
import {
  Eraser, Shrink, Plus, RefreshCw, RotateCcw, Undo2, Square, Power,
  Cpu, Brain, Zap, Eye, Lightbulb, Shield, Bell,
  HelpCircle, List, Activity, User, ListTodo, Wrench, FileText, Download,
  Bot, Users, Crosshair, Minimize2, Navigation, FileCode, Server, Package,
  Bug, Terminal, Cog, MessageSquare, Volume2,
  BarChart3, MessageCircle, Settings, Sparkles, Target, Folder, GitBranch,
  Pencil, Slash, Send,
} from 'lucide-react';
import type React from 'react';

export function cmdIcon(name: string, size = 14): React.ReactNode {
  const props = { size };
  switch (name) {
    case 'Eraser': return <Eraser {...props} />;
    case 'Shrink': return <Shrink {...props} />;
    case 'Plus': return <Plus {...props} />;
    case 'RefreshCw': return <RefreshCw {...props} />;
    case 'RotateCcw': return <RotateCcw {...props} />;
    case 'Undo2': return <Undo2 {...props} />;
    case 'Square': return <Square {...props} />;
    case 'Power': return <Power {...props} />;
    case 'Cpu': return <Cpu {...props} />;
    case 'Brain': return <Brain {...props} />;
    case 'Zap': return <Zap {...props} />;
    case 'Eye': return <Eye {...props} />;
    case 'Lightbulb': return <Lightbulb {...props} />;
    case 'Shield': return <Shield {...props} />;
    case 'Bell': return <Bell {...props} />;
    case 'HelpCircle': return <HelpCircle {...props} />;
    case 'List': return <List {...props} />;
    case 'Activity': return <Activity {...props} />;
    case 'User': return <User {...props} />;
    case 'ListTodo': return <ListTodo {...props} />;
    case 'Wrench': return <Wrench {...props} />;
    case 'FileText': return <FileText {...props} />;
    case 'Download': return <Download {...props} />;
    case 'Bot': return <Bot {...props} />;
    case 'Users': return <Users {...props} />;
    case 'Crosshair': return <Crosshair {...props} />;
    case 'Minimize2': return <Minimize2 {...props} />;
    case 'Navigation': return <Navigation {...props} />;
    case 'FileCode': return <FileCode {...props} />;
    case 'Server': return <Server {...props} />;
    case 'Package': return <Package {...props} />;
    case 'Bug': return <Bug {...props} />;
    case 'Terminal': return <Terminal {...props} />;
    case 'Cog': return <Cog {...props} />;
    case 'MessageSquare': return <MessageSquare {...props} />;
    case 'Volume2': return <Volume2 {...props} />;
    case 'BarChart3': return <BarChart3 {...props} />;
    case 'MessageCircle': return <MessageCircle {...props} />;
    case 'Settings': return <Settings {...props} />;
    case 'Sparkles': return <Sparkles {...props} />;
    case 'Target': return <Target {...props} />;
    case 'Folder': return <Folder {...props} />;
    case 'GitBranch': return <GitBranch {...props} />;
    case 'Pencil': return <Pencil {...props} />;
    case 'Send': return <Send {...props} />;
    default: return <Slash {...props} />;
  }
}

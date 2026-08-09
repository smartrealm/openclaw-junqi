export type BusinessApplicationsView = 'tools' | 'activity' | 'runtime';

export function parseBusinessApplicationsView(search: string): BusinessApplicationsView {
  const view = new URLSearchParams(search).get('view');
  if (view === 'activity' || view === 'runtime') return view;
  return 'tools';
}

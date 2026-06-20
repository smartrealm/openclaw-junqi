/**
 * UIShowcase — vertical slice proving the shadcn integration end-to-end:
 * Tailwind v4 + token bridging (aegis ↔ shadcn HSL) + cn() + Inter font +
 * dark: variant wired to [data-theme] + ring-card + Radix interactions.
 *
 * Reachable at #/ui-showcase (no nav entry, no FeatureRoute gate — it's a
 * verification page). Existing pages are untouched; this only exercises the
 * new ui/* components.
 */
import { useState } from 'react';
import { Settings, ChevronDown, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-aegis-text-muted uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

export default function UIShowcase() {
  const [sw, setSw] = useState(true);
  const [sel, setSel] = useState('teal');
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto p-8 max-w-3xl mx-auto space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-aegis-text">shadcn 组件验证</h1>
        <p className="text-sm text-aegis-text-muted">
          Inter 字体 · teal primary 桥接 · ring-card · <code className="text-xs">dark:</code> 联动 <code className="text-xs">data-theme</code>
        </p>
      </header>

      <Section title="Buttons (primary 桥接 teal)">
        <div className="flex flex-wrap items-center gap-3">
          <Button>主要按钮</Button>
          <Button variant="secondary">次要</Button>
          <Button variant="outline">描边</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="destructive">危险</Button>
          <Button variant="link">链接</Button>
          <Button size="sm">小</Button>
          <Button size="lg">大</Button>
          <Button disabled>禁用</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>默认</Badge>
          <Badge variant="secondary">次要</Badge>
          <Badge variant="outline">描边</Badge>
          <Badge variant="destructive">危险</Badge>
        </div>
      </Section>

      <Section title="Card (ring 不 border + 软阴影 + 1rem 圆角)">
        <Card>
          <CardHeader>
            <CardTitle>任务卡片</CardTitle>
            <CardDescription>验证 ring 边框与 teal accent 在暗/亮主题下的表现</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">切换主题（设置页）观察 card 背景、ring、primary 是否随 data-theme 翻转。</p>
            <div className="flex gap-2">
              <Badge variant="secondary">dark-aware</Badge>
              <Badge>teal primary</Badge>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Input + Label">
        <div className="space-y-2 max-w-sm">
          <Label htmlFor="demo-input">名称</Label>
          <Input id="demo-input" placeholder="输入内容…" />
        </div>
      </Section>

      <Section title="Switch · Select · DropdownMenu · Tooltip">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch checked={sw} onCheckedChange={setSw} />
            <span className="text-sm text-aegis-text">{sw ? '开' : '关'}</span>
          </div>
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="teal">Teal</SelectItem>
              <SelectItem value="blue">Blue</SelectItem>
              <SelectItem value="green">Green</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">菜单 <ChevronDown className="size-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem><Settings className="size-4" /> 设置</DropdownMenuItem>
              <DropdownMenuItem><Rocket className="size-4" /> 启动</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="sm">悬停看提示</Button></TooltipTrigger>
              <TooltipContent>Tooltip 联动成功</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Section>

      <Section title="Dialog">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button variant="outline">打开弹窗</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>对话框标题</DialogTitle>
              <DialogDescription>验证 Radix Dialog 的遮罩、居中、缩放动画在 aegis 主题下正常。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={() => setDialogOpen(false)}>确认</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Separator · Skeleton">
        <Separator />
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Section>
    </div>
  );
}

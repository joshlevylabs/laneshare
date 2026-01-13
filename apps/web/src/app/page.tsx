'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Zap,
  GitBranch,
  MessageSquare,
  Search,
  LayoutDashboard,
  FileText,
  Map,
  Users,
  ArrowRight,
  Check,
  Github,
  Database,
  Cloud,
  Sparkles,
  Code2,
  Target,
  Workflow,
  Shield,
  Clock,
  ChevronRight,
  Play,
  Bot,
  Layers,
  Share2,
  BarChart3,
  Rocket,
  Star,
} from 'lucide-react'

// Animated gradient background
function GradientBackground() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 via-purple-600/10 to-pink-600/20 dark:from-blue-600/10 dark:via-purple-600/5 dark:to-pink-600/10" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/30 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-full blur-3xl" />
    </div>
  )
}

// Feature card component
function FeatureCard({
  icon: Icon,
  title,
  description,
  badge,
}: {
  icon: React.ElementType
  title: string
  description: string
  badge?: string
}) {
  return (
    <div className="group relative p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
      {badge && (
        <span className="absolute -top-3 right-4 px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-full">
          {badge}
        </span>
      )}
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  )
}

// Integration logo
function IntegrationLogo({ icon: Icon, name }: { icon: React.ElementType; name: string }) {
  return (
    <div className="flex items-center gap-3 px-6 py-3 rounded-xl bg-card/50 border border-border/50 hover:border-primary/30 transition-colors">
      <Icon className="w-6 h-6 text-muted-foreground" />
      <span className="font-medium">{name}</span>
    </div>
  )
}

// Pricing card
function PricingCard({
  name,
  price,
  description,
  features,
  popular,
  ctaText,
}: {
  name: string
  price: string
  description: string
  features: string[]
  popular?: boolean
  ctaText: string
}) {
  return (
    <div
      className={`relative p-8 rounded-2xl border ${
        popular
          ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
          : 'border-border/50 bg-card/50'
      }`}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-semibold bg-primary text-primary-foreground rounded-full">
          Most Popular
        </span>
      )}
      <h3 className="text-xl font-semibold mb-2">{name}</h3>
      <div className="mb-4">
        <span className="text-4xl font-bold">{price}</span>
        {price !== 'Custom' && <span className="text-muted-foreground">/month</span>}
      </div>
      <p className="text-muted-foreground text-sm mb-6">{description}</p>
      <ul className="space-y-3 mb-8">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <Check className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Button className="w-full" variant={popular ? 'default' : 'outline'}>
        {ctaText}
      </Button>
    </div>
  )
}

// Workflow step
function WorkflowStep({
  number,
  title,
  description,
}: {
  number: number
  title: string
  description: string
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
        {number}
      </div>
      <div>
        <h4 className="font-semibold mb-1">{title}</h4>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  )
}

// Stat card
function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center p-6">
      <div className="text-4xl font-bold text-primary mb-2">{value}</div>
      <div className="text-muted-foreground text-sm">{label}</div>
    </div>
  )
}

export default function LandingPage() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled ? 'bg-background/80 backdrop-blur-lg border-b border-border/50' : ''
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">LaneShare</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              How It Works
            </a>
            <a href="#integrations" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Integrations
            </a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </a>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Log In
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm">
                Get Started <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <GradientBackground />
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="w-4 h-4" />
              <span>Introducing LanePilot AI Assistant</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
              Vibe-Coding
              <br />
              <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-transparent bg-clip-text">
                Collaboration
              </span>
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Connect your repositories, understand your architecture, and generate context-packed
              prompts for AI coding agents. Ship faster with intelligent collaboration.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <Link href="/login">
                <Button size="lg" className="text-base px-8">
                  Start Free <Rocket className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="text-base px-8">
                <Play className="w-5 h-5 mr-2" /> Watch Demo
              </Button>
            </div>

            {/* Hero Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              <StatCard value="10x" label="Faster Context" />
              <StatCard value="50+" label="Integrations" />
              <StatCard value="99.9%" label="Uptime" />
              <StatCard value="24/7" label="AI Assistant" />
            </div>
          </div>

          {/* Hero Image/Dashboard Preview */}
          <div className="mt-20 relative">
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 pointer-events-none" />
            <div className="rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm p-4 shadow-2xl shadow-primary/5">
              <div className="rounded-xl bg-secondary/50 aspect-video flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <LayoutDashboard className="w-10 h-10 text-primary" />
                  </div>
                  <p className="text-muted-foreground">Interactive Dashboard Preview</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trusted By Section */}
      <section className="py-16 border-y border-border/50">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-muted-foreground text-sm mb-8">
            TRUSTED BY ENGINEERING TEAMS AT
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-60">
            {['Startups', 'Agencies', 'Enterprise', 'Open Source'].map((company) => (
              <div key={company} className="text-xl font-semibold text-muted-foreground">
                {company}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Everything You Need to
              <br />
              <span className="text-primary">Ship Faster</span>
            </h2>
            <p className="text-muted-foreground text-lg">
              From multi-repo management to AI-powered coding assistance, LaneShare provides all
              the tools your team needs to collaborate effectively.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={Bot}
              title="LanePilot AI Assistant"
              description="Generate context-rich prompts for Cursor, Claude Code, and other AI coding agents. Get the perfect context every time."
              badge="AI-Powered"
            />
            <FeatureCard
              icon={GitBranch}
              title="Multi-Repo Management"
              description="Connect unlimited GitHub repositories to a single project. Sync automatically with webhooks for real-time updates."
            />
            <FeatureCard
              icon={Search}
              title="Semantic Code Search"
              description="Find code by meaning, not just keywords. Our AI-powered search understands your codebase like a senior engineer."
            />
            <FeatureCard
              icon={LayoutDashboard}
              title="Kanban Task Board"
              description="Jira-like task management with sprints, story points, and drag-and-drop. Epics, stories, bugs, and more."
            />
            <FeatureCard
              icon={Map}
              title="Architecture Mapping"
              description="Auto-generate visual maps of your system architecture. See how screens, APIs, and databases connect."
            />
            <FeatureCard
              icon={FileText}
              title="Auto Documentation"
              description="AI-generated documentation that stays in sync with your code. Never write docs from scratch again."
            />
            <FeatureCard
              icon={Layers}
              title="Feature Tracing"
              description="Trace complete feature flows from UI to database. Understand the full stack for any feature."
            />
            <FeatureCard
              icon={Share2}
              title="Team Collaboration"
              description="Invite team members with role-based access. Share context, not confusion."
            />
            <FeatureCard
              icon={Shield}
              title="Enterprise Security"
              description="Row-level security, encrypted tokens, and OAuth integration. Your code stays safe."
            />
          </div>
        </div>
      </section>

      {/* LanePilot Spotlight Section */}
      <section className="py-24 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                <Sparkles className="w-4 h-4" />
                <span>Meet LanePilot</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                Your AI Coding Companion That Actually Understands Your Codebase
              </h2>
              <p className="text-muted-foreground text-lg mb-8">
                LanePilot analyzes your connected repositories and generates three powerful
                artifacts for every coding task:
              </p>

              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Code2 className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Context Pack</h4>
                    <p className="text-muted-foreground text-sm">
                      Relevant code snippets from all your repos, curated by AI
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Agent Prompt</h4>
                    <p className="text-muted-foreground text-sm">
                      Copy-paste ready prompts for Cursor, Claude Code, or any AI agent
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                    <Target className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Verification Checklist</h4>
                    <p className="text-muted-foreground text-sm">
                      Step-by-step checklist to verify the implementation is correct
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">LanePilot</div>
                    <div className="text-xs text-muted-foreground">AI Assistant</div>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="p-3 rounded-lg bg-secondary/50">
                    <p className="font-medium mb-2">Context Pack Generated</p>
                    <p className="text-muted-foreground text-xs">
                      Found 12 relevant files across 3 repositories...
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-primary/10">
                    <p className="font-medium mb-2">Agent Prompt Ready</p>
                    <p className="text-muted-foreground text-xs">
                      Optimized for Claude Code with full context...
                    </p>
                  </div>
                </div>
              </div>
              {/* Decorative elements */}
              <div className="absolute -top-4 -right-4 w-24 h-24 bg-primary/20 rounded-full blur-2xl" />
              <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-purple-500/20 rounded-full blur-2xl" />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Get Started in Minutes</h2>
            <p className="text-muted-foreground text-lg">
              Connect your repos and start collaborating with AI in just four simple steps.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <WorkflowStep
              number={1}
              title="Create a Project"
              description="Start a new project and invite your team members with role-based access."
            />
            <WorkflowStep
              number={2}
              title="Connect Repositories"
              description="Link your GitHub repos with OAuth or PAT. Auto-sync keeps everything updated."
            />
            <WorkflowStep
              number={3}
              title="Explore & Understand"
              description="View architecture maps, search code semantically, and browse auto-generated docs."
            />
            <WorkflowStep
              number={4}
              title="Ship with LanePilot"
              description="Get AI-generated prompts with full context. Copy to Cursor or Claude Code and ship."
            />
          </div>
        </div>
      </section>

      {/* Integrations Section */}
      <section id="integrations" className="py-24 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Integrates With Your Stack
            </h2>
            <p className="text-muted-foreground text-lg">
              Connect the tools you already use. More integrations coming soon.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <IntegrationLogo icon={Github} name="GitHub" />
            <IntegrationLogo icon={Database} name="Supabase" />
            <IntegrationLogo icon={Cloud} name="Vercel" />
            <IntegrationLogo icon={Code2} name="Next.js" />
            <IntegrationLogo icon={Workflow} name="Cursor" />
            <IntegrationLogo icon={Bot} name="Claude Code" />
          </div>

          <div className="text-center mt-12">
            <p className="text-muted-foreground mb-4">Coming Soon</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {['GitLab', 'Bitbucket', 'Linear', 'Notion', 'Slack', 'Discord'].map((name) => (
                <span
                  key={name}
                  className="px-4 py-2 rounded-full bg-muted/50 text-muted-foreground text-sm"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Task Management Feature Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1">
              <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xl">
                {/* Mock Kanban Board */}
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium">Sprint Board</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-500">Sprint 12</span>
                  </div>
                </div>
                <div className="p-4 grid grid-cols-4 gap-3">
                  {['To Do', 'In Progress', 'In Review', 'Done'].map((column, i) => (
                    <div key={column} className="rounded-lg bg-secondary/50 p-2">
                      <div className="text-xs font-medium text-muted-foreground mb-2">{column}</div>
                      {[1, 2].slice(0, i === 1 ? 2 : 1).map((_, j) => (
                        <div
                          key={j}
                          className="p-2 rounded bg-card border border-border text-xs mb-2"
                        >
                          <div className="font-medium mb-1">LS-{10 + i * 3 + j}</div>
                          <div className="text-muted-foreground">Task description...</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                <LayoutDashboard className="w-4 h-4" />
                <span>Task Management</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                Jira-Like Task Tracking,
                <br />
                Built for Developers
              </h2>
              <p className="text-muted-foreground text-lg mb-8">
                Full-featured project management with sprints, story points, and everything you
                need to ship on time.
              </p>

              <ul className="space-y-3">
                {[
                  'Epics, Stories, Tasks, Bugs, and Spikes',
                  'Sprint planning with goals and timelines',
                  'Drag-and-drop Kanban board',
                  'Story points and priority levels',
                  'Activity logs and comment threads',
                  'Link tasks to specific repositories',
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-green-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture Mapping Feature Section */}
      <section className="py-24 bg-gradient-to-b from-transparent to-secondary/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                <Map className="w-4 h-4" />
                <span>Architecture Mapping</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                Visualize Your Entire
                <br />
                System Architecture
              </h2>
              <p className="text-muted-foreground text-lg mb-8">
                Auto-generated architecture maps that show how your apps, APIs, and databases
                connect. Understand your system at a glance.
              </p>

              <ul className="space-y-3">
                {[
                  'Auto-discover pages, routes, and endpoints',
                  'Map database tables and relationships',
                  'Trace feature flows from UI to DB',
                  'Interactive node-based visualization',
                  'Export and share with your team',
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-green-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-xl">
                {/* Mock Architecture Map */}
                <div className="aspect-video relative">
                  {/* Nodes */}
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs">
                    <div className="font-medium text-blue-500">Next.js App</div>
                  </div>
                  <div className="absolute top-1/2 left-8 -translate-y-1/2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-xs">
                    <div className="font-medium text-green-500">API Routes</div>
                  </div>
                  <div className="absolute top-1/2 right-8 -translate-y-1/2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-xs">
                    <div className="font-medium text-purple-500">Supabase</div>
                  </div>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-xs">
                    <div className="font-medium text-orange-500">External APIs</div>
                  </div>
                  {/* Connection lines (SVG) */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <line
                      x1="50%"
                      y1="20%"
                      x2="20%"
                      y2="50%"
                      stroke="currentColor"
                      strokeOpacity="0.2"
                      strokeDasharray="4"
                    />
                    <line
                      x1="50%"
                      y1="20%"
                      x2="80%"
                      y2="50%"
                      stroke="currentColor"
                      strokeOpacity="0.2"
                      strokeDasharray="4"
                    />
                    <line
                      x1="20%"
                      y1="50%"
                      x2="50%"
                      y2="80%"
                      stroke="currentColor"
                      strokeOpacity="0.2"
                      strokeDasharray="4"
                    />
                    <line
                      x1="80%"
                      y1="50%"
                      x2="50%"
                      y2="80%"
                      stroke="currentColor"
                      strokeOpacity="0.2"
                      strokeDasharray="4"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Loved by Developers</h2>
            <p className="text-muted-foreground text-lg">
              See what engineering teams are saying about LaneShare.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                quote:
                  "LanePilot has completely changed how we work with AI coding tools. The context packs are incredibly accurate.",
                author: 'Sarah Chen',
                role: 'Tech Lead, Startup',
                avatar: 'SC',
              },
              {
                quote:
                  "Finally, a tool that understands multi-repo projects. The architecture mapping alone has saved us hours of onboarding.",
                author: 'Marcus Johnson',
                role: 'Engineering Manager',
                avatar: 'MJ',
              },
              {
                quote:
                  "The semantic search is magic. I can find code by describing what it does, not just by keywords.",
                author: 'Alex Rivera',
                role: 'Senior Developer',
                avatar: 'AR',
              },
            ].map((testimonial, i) => (
              <div key={i} className="p-6 rounded-2xl border border-border/50 bg-card/50">
                <div className="flex gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                  ))}
                </div>
                <p className="text-sm mb-6">&ldquo;{testimonial.quote}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{testimonial.author}</div>
                    <div className="text-xs text-muted-foreground">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-muted-foreground text-lg">
              Start free, scale as you grow. No hidden fees.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <PricingCard
              name="Starter"
              price="$0"
              description="Perfect for indie developers and small projects."
              features={[
                'Up to 3 repositories',
                'Basic LanePilot prompts',
                'Keyword search',
                'Basic task management',
                '1 team member',
              ]}
              ctaText="Get Started Free"
            />
            <PricingCard
              name="Pro"
              price="$29"
              description="For growing teams that need more power."
              features={[
                'Unlimited repositories',
                'Advanced LanePilot with context packs',
                'Semantic code search',
                'Full task management with sprints',
                'Up to 10 team members',
                'Architecture mapping',
                'Auto documentation',
              ]}
              popular
              ctaText="Start Pro Trial"
            />
            <PricingCard
              name="Enterprise"
              price="Custom"
              description="For large teams with custom requirements."
              features={[
                'Everything in Pro',
                'Unlimited team members',
                'SSO/SAML authentication',
                'Custom integrations',
                'Priority support',
                'SLA guarantees',
                'On-premise deployment',
              ]}
              ctaText="Contact Sales"
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="relative rounded-3xl bg-gradient-to-r from-blue-600 to-purple-600 p-12 md:p-20 text-center overflow-hidden">
            <div className="absolute inset-0 bg-grid-white/10 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
                Ready to Ship Faster?
              </h2>
              <p className="text-lg text-white/80 max-w-2xl mx-auto mb-8">
                Join thousands of developers who are using LaneShare to collaborate with AI and
                ship better code, faster.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/login">
                  <Button size="lg" className="bg-white text-primary hover:bg-white/90">
                    Get Started Free <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
                  Schedule Demo
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 border-t border-border/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div>
              <Link href="/" className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="text-xl font-bold">LaneShare</span>
              </Link>
              <p className="text-muted-foreground text-sm">
                Vibe-coding collaboration with AI-powered context packs and agent prompts.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><a href="#integrations" className="hover:text-foreground transition-colors">Integrations</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Changelog</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">API Reference</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Community</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">About</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Privacy</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Terms</a></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-border/50">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} LaneShare. All rights reserved.
            </p>
            <div className="flex items-center gap-4 mt-4 md:mt-0">
              <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
                <Github className="w-5 h-5" />
              </a>
              <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

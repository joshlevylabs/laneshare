'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight, CheckSquare, Square, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PRDUserStory } from '@laneshare/shared'

interface PRDStoryListProps {
  stories: PRDUserStory[]
  selectedStories: string[]
  onStorySelect: (storyId: string, selected: boolean) => void
  onSelectAll: () => void
}

export function PRDStoryList({
  stories,
  selectedStories,
  onStorySelect,
  onSelectAll,
}: PRDStoryListProps) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set())

  const toggleExpand = (storyId: string) => {
    const newExpanded = new Set(expandedStories)
    if (newExpanded.has(storyId)) {
      newExpanded.delete(storyId)
    } else {
      newExpanded.add(storyId)
    }
    setExpandedStories(newExpanded)
  }

  const allSelected = stories.length > 0 && selectedStories.length === stories.length
  const someSelected = selectedStories.length > 0 && selectedStories.length < stories.length

  const handleSelectAllClick = () => {
    if (allSelected) {
      // Deselect all
      stories.forEach(s => onStorySelect(s.id, false))
    } else {
      onSelectAll()
    }
  }

  const getPriorityBadge = (priority: number) => {
    if (priority === 1) return <Badge variant="destructive">P1</Badge>
    if (priority === 2) return <Badge variant="default">P2</Badge>
    if (priority === 3) return <Badge variant="secondary">P3</Badge>
    return <Badge variant="outline">P{priority}</Badge>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {selectedStories.length} of {stories.length} selected
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSelectAllClick}
          className="text-xs"
        >
          {allSelected ? (
            <>
              <CheckSquare className="h-3 w-3 mr-1" />
              Deselect All
            </>
          ) : (
            <>
              <Square className="h-3 w-3 mr-1" />
              Select All
            </>
          )}
        </Button>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {stories.map((story) => {
          const isSelected = selectedStories.includes(story.id)
          const isExpanded = expandedStories.has(story.id)

          return (
            <Card
              key={story.id}
              className={cn(
                'transition-colors',
                isSelected && 'border-primary bg-primary/5'
              )}
            >
              <CardContent className="p-3">
                <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(story.id)}>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => onStorySelect(story.id, checked === true)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">
                          {story.id}
                        </span>
                        {getPriorityBadge(story.priority)}
                        {story.estimatedPoints && (
                          <Badge variant="outline" className="text-xs">
                            {story.estimatedPoints} pts
                          </Badge>
                        )}
                        {story.passes && (
                          <Badge variant="default" className="bg-green-500">
                            Done
                          </Badge>
                        )}
                      </div>
                      <p className="font-medium text-sm mt-1">{story.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {story.description}
                      </p>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </div>

                  <CollapsibleContent className="mt-3 ml-8 space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                        Acceptance Criteria
                      </h4>
                      <ul className="space-y-1">
                        {story.acceptanceCriteria.map((criterion, idx) => (
                          <li key={idx} className="text-xs flex items-start gap-2">
                            <span className="text-muted-foreground">•</span>
                            <span>{criterion}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {story.notes && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                          Notes
                        </h4>
                        <p className="text-xs">{story.notes}</p>
                      </div>
                    )}

                    {(story.linkedRepoIds?.length || story.linkedDocIds?.length || story.linkedFeatureIds?.length) && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-1">
                          Linked Context
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          {story.linkedRepoIds?.map(id => (
                            <Badge key={id} variant="outline" className="text-xs">
                              Repo: {id.slice(0, 8)}
                            </Badge>
                          ))}
                          {story.linkedDocIds?.map(id => (
                            <Badge key={id} variant="outline" className="text-xs">
                              Doc: {id.slice(0, 8)}
                            </Badge>
                          ))}
                          {story.linkedFeatureIds?.map(id => (
                            <Badge key={id} variant="outline" className="text-xs">
                              Feature: {id.slice(0, 8)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

'use client';

import { MigrationPath } from '@/lib/rift/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface RiftSelectionPanelProps {
  selectedPaths: MigrationPath[];
  onRemovePath: (itemPath: string) => void;
  onChangeScope: (itemPath: string, scope: MigrationPath['scope']) => void;
  onClearAll?: () => void;
}

function truncatePath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 3) return path;
  return '.../' + segments.slice(-3).join('/');
}

const scopeValues: { label: string; value: MigrationPath['scope'] }[] = [
  { label: 'Item Only', value: 'SingleItem' },
  { label: 'Item + Children', value: 'ItemAndChildren' },
  { label: 'Item + Descendants', value: 'ItemAndDescendants' },
  { label: 'Children Only', value: 'ChildrenOnly' },
  { label: 'Descendants Only', value: 'DescendantsOnly' },
];

export function RiftSelectionPanel({
  selectedPaths,
  onRemovePath,
  onChangeScope,
  onClearAll,
}: RiftSelectionPanelProps) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground mb-3 flex justify-between items-center">
        <span>SELECTED ({selectedPaths.length} path{selectedPaths.length !== 1 ? 's' : ''})</span>
        {selectedPaths.length > 0 && onClearAll && (
          <Button
            variant="link"
            colorScheme="danger"
            size="xs"
            onClick={onClearAll}
            className="p-0 h-auto"
          >
            Clear All
          </Button>
        )}
      </div>

      {selectedPaths.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-xs">
          Select items from the content tree
        </div>
      ) : (
        selectedPaths.map((mp) => (
          <div
            key={mp.itemPath}
            className="border border-border rounded-md p-2.5 mb-2 text-xs"
          >
            {/* Top row: path + remove */}
            <div className="flex justify-between items-start gap-2">
              <span className="font-bold text-foreground break-all">
                {truncatePath(mp.itemPath)}
              </span>
              <Button
                variant="ghost"
                size="xs"
                colorScheme="danger"
                onClick={() => onRemovePath(mp.itemPath)}
                className="shrink-0 p-0 h-auto min-w-0 text-sm leading-none"
              >
                &times;
              </Button>
            </div>

            {/* Scope dropdown */}
            <Select
              value={mp.scope}
              onValueChange={(val) =>
                onChangeScope(mp.itemPath, val as MigrationPath['scope'])
              }
            >
              <SelectTrigger size="sm" className="mt-1.5 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopeValues.map((sv) => (
                  <SelectItem key={sv.value} value={sv.value}>
                    {sv.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))
      )}
    </div>
  );
}

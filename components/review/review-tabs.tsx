"use client";

import * as React from "react";
import * as Tabs from "@radix-ui/react-tabs";

export function ReviewTabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  return (
    <Tabs.Root defaultValue={tabs[0]?.id}>
      <Tabs.List aria-label="Review views" className="mb-5 inline-flex flex-wrap rounded-lg bg-page p-1 text-[13.5px]">
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t.id}
            value={t.id}
            className="rounded-md px-3 py-1.5 text-muted data-[state=active]:bg-surface data-[state=active]:font-semibold data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t.id} value={t.id}>
          {t.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

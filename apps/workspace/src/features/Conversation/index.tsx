// Adapted from LobeHub v0.162.25 Conversation/components/VirtualizedList/index.tsx
// and AutoScroll.tsx. Copyright (c) 2023 - current LobeHub. MIT; see NOTICE.
import { memo, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "antd";
import type { Message } from "../../types";
import Item from "./ChatItem";

interface Props {
  id: string;
  messages: Message[];
  generatingId?: string;
  onCopy: (text: string) => void;
  onRetry: () => void;
}

export default memo(function Conversation({ id, messages, generatingId, onCopy, onRetry }: Props) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);
  const lastContent = messages.at(-1)?.content;

  useEffect(() => {
    virtuosoRef.current?.scrollToIndex({ align: "end", behavior: "auto", index: "LAST" });
  }, [id]);

  useEffect(() => {
    if (atBottom && generatingId && !isScrolling) {
      virtuosoRef.current?.scrollToIndex({ align: "end", behavior: "auto", index: "LAST" });
    }
  }, [atBottom, generatingId, isScrolling, lastContent]);

  return (
    <div className="conversation">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={80}
        computeItemKey={(_, item) => item.id}
        followOutput="auto"
        initialTopMostItemIndex={messages.length - 1}
        isScrolling={setIsScrolling}
        overscan={400}
        itemContent={(index, item) => (
          <Item
            item={item}
            generating={item.id === generatingId}
            onCopy={onCopy}
            onRetry={
              !generatingId && index === messages.length - 1 && item.role === "assistant"
                ? onRetry
                : undefined
            }
          />
        )}
      />
      {!atBottom && (
        <Button
          className="back-bottom"
          size="small"
          onClick={() =>
            virtuosoRef.current?.scrollToIndex({ align: "end", behavior: "smooth", index: "LAST" })
          }
        >
          回到底部
        </Button>
      )}
    </div>
  );
});

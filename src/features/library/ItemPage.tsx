import type { ComponentType } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRepo } from "@/app/store";
import type { ItemType, LoadedItem } from "@/domain/models/types";
import { EmptyState } from "@/components/feedback/Overlays";
import { BookWorkbench } from "@/features/book/BookWorkbench";
import { DocumentWorkbench } from "@/features/document/DocumentWorkbench";
import { BlogWorkbench } from "@/features/blog/BlogWorkbench";
import { SeriesWorkbench } from "@/features/series/SeriesWorkbench";
import { PhotoWorkbench } from "@/features/photography/PhotoWorkbench";
import { PdfWorkbench } from "@/features/pdf/PdfWorkbench";

export interface WorkbenchProps {
  item: LoadedItem;
  unitId?: string;
}

/**
 * ItemRendererRegistry (technical design §4): each item type maps to its own
 * workbench. The PDF workbench only receives read services — no Markdown saver.
 */
export const ItemRendererRegistry: Record<ItemType, ComponentType<WorkbenchProps>> = {
  book: BookWorkbench,
  document: DocumentWorkbench,
  blog: BlogWorkbench,
  article_series: SeriesWorkbench,
  photo_album: PhotoWorkbench,
  pdf: PdfWorkbench,
};

export function ItemPage() {
  const { itemId, unitId } = useParams();
  const repo = useRepo();
  const navigate = useNavigate();
  const item = itemId ? repo.getItem(itemId) : undefined;
  if (!item)
    return (
      <EmptyState title="找不到这个作品" hint="它可能已被移到回收站，或在外部被移动。">
        <button className="lf-btn" onClick={() => navigate("/")}>
          返回作品库
        </button>
      </EmptyState>
    );
  const W = ItemRendererRegistry[item.meta.type];
  return <W key={item.meta.id} item={item} unitId={unitId} />;
}

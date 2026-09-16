import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowUp, ArrowDown, Copy, ListOrdered, List, AlignJustify } from "lucide-react";
import type { StructuredTermItem, TermFormat, TermsTemplate } from "@/lib/db";
import { uid } from "@/lib/db";

interface StructuredTermsEditorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  terms: StructuredTermItem[];
  onChange: (terms: StructuredTermItem[]) => void;
  templates?: TermsTemplate[];
  onApplyTemplate?: (templateId: string) => void;
  documentType?: "quotation" | "invoice";
}

export function StructuredTermsEditor({
  enabled,
  onEnabledChange,
  terms,
  onChange,
  templates = [],
  onApplyTemplate,
  documentType = "quotation",
}: StructuredTermsEditorProps) {
  function addTerm() {
    const newTerm: StructuredTermItem = {
      id: uid(),
      order: terms.length + 1,
      text: "",
      format: "NUMBERED",
    };
    onChange([...terms, newTerm]);
  }

  function updateTerm(index: number, patch: Partial<StructuredTermItem>) {
    const next = [...terms];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function deleteTerm(index: number) {
    const next = terms.filter((_, i) => i !== index).map((t, idx) => ({ ...t, order: idx + 1 }));
    onChange(next);
  }

  function duplicateTerm(index: number) {
    const orig = terms[index];
    const copy: StructuredTermItem = {
      ...orig,
      id: uid(),
      order: index + 2,
    };
    const next = [...terms];
    next.splice(index + 1, 0, copy);
    onChange(next.map((t, idx) => ({ ...t, order: idx + 1 })));
  }

  function moveTerm(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= terms.length) return;
    const next = [...terms];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    onChange(next.map((t, idx) => ({ ...t, order: idx + 1 })));
  }

  return (
    <Card className="p-4 space-y-4 border-border/80 bg-card shadow-soft">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">Terms & Conditions</span>
            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full border border-border/60 font-medium">
              Structured Alignment
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Commercial payment schedules, delivery conditions, and validity. Renders with hanging indents and page-break protection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="include-terms" className="text-xs font-medium text-foreground">
            Include in {documentType === "quotation" ? "Quotation" : "Invoice"}
          </Label>
          <Switch
            id="include-terms"
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        </div>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {templates.length > 0 && onApplyTemplate && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Template:</span>
                <Select onValueChange={onApplyTemplate}>
                  <SelectTrigger className="w-56 h-8 text-xs">
                    <SelectValue placeholder={`Load ${documentType === "quotation" ? "Quotation" : "Invoice"} Terms`} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTerm}
              className="h-8 text-xs gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add Term
            </Button>
          </div>

          {terms.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-border/80 rounded-xl bg-secondary/20 text-xs text-muted-foreground">
              No terms added. Click <strong>+ Add Term</strong> or select a template above.
            </div>
          ) : (
            <div className="space-y-2">
              {terms.map((term, idx) => (
                <div
                  key={term.id || idx}
                  className="flex items-start gap-2 p-2.5 rounded-xl border border-border/70 bg-secondary/25 text-xs"
                >
                  <div className="w-8 pt-1 text-center font-bold text-foreground font-mono shrink-0">
                    {term.format === "BULLET" ? "•" : term.format === "PARAGRAPH" ? "§" : `${idx + 1}.`}
                  </div>

                  <Textarea
                    rows={2}
                    value={term.text}
                    onChange={(e) => updateTerm(idx, { text: e.target.value })}
                    placeholder="Enter condition (e.g. Delivery within 3 weeks from receipt of advance PO...)"
                    className="text-xs flex-1 min-h-[52px] bg-card"
                  />

                  <div className="flex flex-col gap-1 shrink-0">
                    <div className="flex items-center gap-1">
                      <Select
                        value={term.format || "NUMBERED"}
                        onValueChange={(v) => updateTerm(idx, { format: v as TermFormat })}
                      >
                        <SelectTrigger className="w-24 h-7 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NUMBERED" className="text-xs">
                            Numbered
                          </SelectItem>
                          <SelectItem value="BULLET" className="text-xs">
                            Bullet
                          </SelectItem>
                          <SelectItem value="PARAGRAPH" className="text-xs">
                            Paragraph
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={idx === 0}
                        onClick={() => moveTerm(idx, "up")}
                      >
                        <ArrowUp className="h-3 w-3 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={idx === terms.length - 1}
                        onClick={() => moveTerm(idx, "down")}
                      >
                        <ArrowDown className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => duplicateTerm(idx)}
                        title="Duplicate Term"
                      >
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive hover:text-destructive/80"
                        onClick={() => deleteTerm(idx)}
                        title="Delete Term"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

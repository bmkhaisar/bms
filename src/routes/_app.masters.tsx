import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Star, StarOff, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  db, uid,
  type SizePreset, type TermsTemplate, type TermItem,
  type GeneralInfoTemplate, type GeneralInfoField,
  type TechSpecTemplate, type TechSpecSection,
  type BankAccount, type QuotationTemplate,
} from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";

export const Route = createFileRoute("/_app/masters")({
  head: () => ({ meta: [{ title: "Masters — Business Management" }] }),
  component: () => (
    <AppShell title="Masters">
      <MastersPage />
    </AppShell>
  ),
});

function MastersPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h2 className="text-xl font-semibold sm:text-2xl">Quotation Masters</h2>
        <p className="text-sm text-muted-foreground">Reusable sizes, terms, general info, technical specs, bank accounts, and quotation templates.</p>
      </div>
      <Tabs defaultValue="sizes" className="space-y-4">
        <TabsList className="w-full flex-wrap justify-start">
          <TabsTrigger value="sizes">Sizes</TabsTrigger>
          <TabsTrigger value="terms">Terms Templates</TabsTrigger>
          <TabsTrigger value="general">General Info</TabsTrigger>
          <TabsTrigger value="tech">Technical Specs</TabsTrigger>
          <TabsTrigger value="banks">Bank Accounts</TabsTrigger>
          <TabsTrigger value="templates">Quotation Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="sizes"><SizesMaster /></TabsContent>
        <TabsContent value="terms"><TermsMaster /></TabsContent>
        <TabsContent value="general"><GeneralInfoMaster /></TabsContent>
        <TabsContent value="tech"><TechSpecMaster /></TabsContent>
        <TabsContent value="banks"><BanksMaster /></TabsContent>
        <TabsContent value="templates"><TemplatesMaster /></TabsContent>
      </Tabs>
    </div>
  );
}

// ================== SIZES ==================
function SizesMaster() {
  const items = useLive<SizePreset>(() => db().sizes.orderBy("label").toArray());
  const [label, setLabel] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function add() {
    if (!label.trim()) return;
    await db().sizes.put({ id: uid(), label: label.trim(), createdAt: Date.now() });
    setLabel(""); toast.success("Size added");
  }
  return (
    <Card className="p-4">
      <div className="mb-3 flex gap-2">
        <Input placeholder="e.g. 10 x 20 ft" value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} className="max-w-sm" />
        <Button onClick={add} className="gap-2"><Plus className="h-4 w-4" /> Add size</Button>
      </div>
      {items.length === 0 ? <Empty text="No sizes yet" /> : (
        <div className="flex flex-wrap gap-2">
          {items.map(s => (
            <Badge key={s.id} variant="secondary" className="cursor-pointer gap-1 py-1.5" onClick={() => setDeleteTarget({ id: s.id, label: s.label })}>
              {s.label} <Trash2 className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title={`Delete size "${deleteTarget?.label}"?`}
        description="This dimension preset will be removed from future quotations."
        destructive
        confirmText="Delete Size"
        isBusy={isDeleting}
        busyText="Deleting..."
        onConfirm={async () => {
          if (!deleteTarget) return;
          setIsDeleting(true);
          try {
            await db().sizes.delete(deleteTarget.id);
            toast.success(`Size "${deleteTarget.label}" deleted`);
            setDeleteTarget(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </Card>
  );
}

// ================== TERMS ==================
function TermsMaster() {
  const items = useLive<TermsTemplate>(() => db().termsTemplates.orderBy("name").toArray());
  const [editing, setEditing] = useState<TermsTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function setDefault(id: string) {
    for (const t of items) await db().termsTemplates.put({ ...t, isDefault: t.id === id });
    toast.success("Default set");
  }
  async function save(t: TermsTemplate) {
    await db().termsTemplates.put(t);
    setEditing(null); toast.success("Saved");
  }
  function newTemplate(): TermsTemplate {
    return { id: uid(), name: "New template", terms: [], createdAt: Date.now() };
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Create multiple templates and apply different ones per quotation.</div>
        <Button onClick={() => setEditing(newTemplate())} className="gap-2"><Plus className="h-4 w-4" /> New template</Button>
      </div>
      {items.length === 0 ? <Empty text="No terms templates yet" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Terms</TableHead><TableHead className="w-40 text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name} {t.isDefault && <Badge className="ml-2">Default</Badge>}</TableCell>
                <TableCell className="text-muted-foreground">{t.terms.length} items</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" title={t.isDefault ? "Unset default" : "Set default"} onClick={() => setDefault(t.id)}>
                    {t.isDefault ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ ...t })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget({ id: t.id, name: t.name })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Terms Template</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Input placeholder="Template name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              <div className="space-y-2">
                {editing.terms.map((term, i) => (
                  <div key={term.id} className="flex items-start gap-2 rounded-md border p-2">
                    <Checkbox checked={term.enabled} onCheckedChange={v => {
                      const list = [...editing.terms]; list[i] = { ...list[i], enabled: !!v }; setEditing({ ...editing, terms: list });
                    }} />
                    <Textarea rows={1} value={term.text} onChange={e => {
                      const list = [...editing.terms]; list[i] = { ...list[i], text: e.target.value }; setEditing({ ...editing, terms: list });
                    }} />
                    <div className="flex flex-col">
                      <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => {
                        const list = [...editing.terms];[list[i - 1], list[i]] = [list[i], list[i - 1]]; setEditing({ ...editing, terms: list });
                      }}><ChevronUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" disabled={i === editing.terms.length - 1} onClick={() => {
                        const list = [...editing.terms];[list[i + 1], list[i]] = [list[i], list[i + 1]]; setEditing({ ...editing, terms: list });
                      }}><ChevronDown className="h-4 w-4" /></Button>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => {
                      const list = [...editing.terms]; list.splice(i, 1); setEditing({ ...editing, terms: list });
                    }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, terms: [...editing.terms, { id: uid(), text: "", enabled: true }] })}>
                  <Plus className="mr-1 h-3 w-3" /> Add term
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && save(editing)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title={`Delete template "${deleteTarget?.name}"?`}
        description="This terms template will be removed from master templates. Existing quotations will retain their current terms."
        destructive
        confirmText="Delete Template"
        isBusy={isDeleting}
        busyText="Deleting..."
        onConfirm={async () => {
          if (!deleteTarget) return;
          setIsDeleting(true);
          try {
            await db().termsTemplates.delete(deleteTarget.id);
            toast.success(`Template "${deleteTarget.name}" deleted`);
            setDeleteTarget(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </Card>
  );
}

// ================== GENERAL INFO ==================
function GeneralInfoMaster() {
  const items = useLive<GeneralInfoTemplate>(() => db().generalInfoTemplates.orderBy("name").toArray());
  const [editing, setEditing] = useState<GeneralInfoTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const DEFAULT_KEYS = ["Configuration", "Transportation", "Foundation", "Structural Stability", "Roof Type", "Ventilation", "Wiring", "Insulation", "Power Connection"];
  function newTemplate(): GeneralInfoTemplate {
    return { id: uid(), name: "New template", fields: DEFAULT_KEYS.map(k => ({ key: k, label: k, value: "" })), createdAt: Date.now() };
  }
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Preset general information sections (configuration, transportation, foundation, etc.)</div>
        <Button onClick={() => setEditing(newTemplate())} className="gap-2"><Plus className="h-4 w-4" /> New template</Button>
      </div>
      {items.length === 0 ? <Empty text="No general info templates yet" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Fields</TableHead><TableHead className="w-40 text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="text-muted-foreground">{t.fields.length} fields</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ ...t, fields: [...t.fields] })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget({ id: t.id, name: t.name })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>General Information Template</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Input placeholder="Template name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              <div className="max-h-[55vh] space-y-1.5 overflow-y-auto scrollbar-hidden">
                {editing.fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-[220px_1fr_auto] gap-2">
                    <Input placeholder="Label" value={f.label} onChange={e => {
                      const list = [...editing.fields]; list[i] = { ...list[i], label: e.target.value, key: e.target.value }; setEditing({ ...editing, fields: list });
                    }} />
                    <Textarea rows={1} placeholder="Value" value={f.value} onChange={e => {
                      const list = [...editing.fields]; list[i] = { ...list[i], value: e.target.value }; setEditing({ ...editing, fields: list });
                    }} />
                    <Button size="icon" variant="ghost" onClick={() => {
                      const list = [...editing.fields]; list.splice(i, 1); setEditing({ ...editing, fields: list });
                    }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, fields: [...editing.fields, { key: "", label: "", value: "" }] })}>
                  <Plus className="mr-1 h-3 w-3" /> Add field
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={async () => { if (editing) { await db().generalInfoTemplates.put(editing); setEditing(null); toast.success("Saved"); } }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title={`Delete template "${deleteTarget?.name}"?`}
        description="This general info template will be permanently removed from presets."
        destructive
        confirmText="Delete Template"
        isBusy={isDeleting}
        busyText="Deleting..."
        onConfirm={async () => {
          if (!deleteTarget) return;
          setIsDeleting(true);
          try {
            await db().generalInfoTemplates.delete(deleteTarget.id);
            toast.success(`Template "${deleteTarget.name}" deleted`);
            setDeleteTarget(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </Card>
  );
}

// ================== TECH SPEC ==================
function TechSpecMaster() {
  const items = useLive<TechSpecTemplate>(() => db().techSpecTemplates.orderBy("name").toArray());
  const [editing, setEditing] = useState<TechSpecTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const DEFAULT_SECTIONS: TechSpecSection[] = [
    { title: "Frame & Structure", rows: [{ label: "Frame Material", value: "" }, { label: "Base Frame", value: "" }] },
    { title: "Panels", rows: [{ label: "Wall", value: "" }, { label: "Roof", value: "" }, { label: "Floor", value: "" }] },
    { title: "Openings", rows: [{ label: "Doors", value: "" }, { label: "Windows", value: "" }] },
    { title: "Insulation", rows: [{ label: "Type", value: "" }, { label: "Thickness", value: "" }] },
  ];

  function newTemplate(kind: "technical" | "electrical" = "technical"): TechSpecTemplate {
    return {
      id: uid(), name: kind === "electrical" ? "New electrical template" : "New technical template",
      kind, createdAt: Date.now(),
      sections: kind === "electrical"
        ? [{ title: "Electrical", rows: [{ label: "Wiring", value: "" }, { label: "Load", value: "" }, { label: "Accessories", value: "" }] }]
        : DEFAULT_SECTIONS.map(s => ({ ...s, rows: [...s.rows] })),
    };
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">Technical & electrical specification templates (frame, panels, wiring, etc.)</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing(newTemplate("technical"))} className="gap-2"><Plus className="h-4 w-4" /> Technical</Button>
          <Button variant="outline" onClick={() => setEditing(newTemplate("electrical"))} className="gap-2"><Plus className="h-4 w-4" /> Electrical</Button>
        </div>
      </div>
      {items.length === 0 ? <Empty text="No spec templates yet" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Sections</TableHead><TableHead className="w-40 text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell><Badge variant="secondary">{t.kind || "technical"}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{t.sections.length} sections</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ ...t, sections: t.sections.map(s => ({ ...s, rows: [...s.rows] })) })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget({ id: t.id, name: t.name })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Specification Template</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Template name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                <Select value={editing.kind || "technical"} onValueChange={v => setEditing({ ...editing, kind: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="electrical">Electrical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-[55vh] space-y-3 overflow-y-auto scrollbar-hidden">
                {editing.sections.map((sec, si) => (
                  <div key={si} className="rounded-md border p-2">
                    <div className="mb-2 flex gap-2">
                      <Input value={sec.title} onChange={e => {
                        const list = [...editing.sections]; list[si] = { ...list[si], title: e.target.value }; setEditing({ ...editing, sections: list });
                      }} />
                      <Button size="icon" variant="ghost" onClick={() => {
                        const list = [...editing.sections]; list.splice(si, 1); setEditing({ ...editing, sections: list });
                      }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <div className="space-y-1.5">
                      {sec.rows.map((r, ri) => (
                        <div key={ri} className="grid grid-cols-[220px_1fr_auto] gap-2">
                          <Input placeholder="Label" value={r.label} onChange={e => {
                            const list = [...editing.sections]; const rows = [...list[si].rows]; rows[ri] = { ...rows[ri], label: e.target.value };
                            list[si] = { ...list[si], rows }; setEditing({ ...editing, sections: list });
                          }} />
                          <Textarea rows={1} placeholder="Value" value={r.value} onChange={e => {
                            const list = [...editing.sections]; const rows = [...list[si].rows]; rows[ri] = { ...rows[ri], value: e.target.value };
                            list[si] = { ...list[si], rows }; setEditing({ ...editing, sections: list });
                          }} />
                          <Button size="icon" variant="ghost" onClick={() => {
                            const list = [...editing.sections]; const rows = [...list[si].rows]; rows.splice(ri, 1);
                            list[si] = { ...list[si], rows }; setEditing({ ...editing, sections: list });
                          }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      ))}
                      <Button size="sm" variant="outline" onClick={() => {
                        const list = [...editing.sections]; list[si] = { ...list[si], rows: [...list[si].rows, { label: "", value: "" }] };
                        setEditing({ ...editing, sections: list });
                      }}><Plus className="mr-1 h-3 w-3" /> Add row</Button>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setEditing({ ...editing, sections: [...editing.sections, { title: "New section", rows: [] }] })}>
                  <Plus className="mr-1 h-3 w-3" /> Add section
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={async () => { if (editing) { await db().techSpecTemplates.put(editing); setEditing(null); toast.success("Saved"); } }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title={`Delete template "${deleteTarget?.name}"?`}
        description="This technical/electrical spec template will be permanently removed from presets."
        destructive
        confirmText="Delete Template"
        isBusy={isDeleting}
        busyText="Deleting..."
        onConfirm={async () => {
          if (!deleteTarget) return;
          setIsDeleting(true);
          try {
            await db().techSpecTemplates.delete(deleteTarget.id);
            toast.success(`Template "${deleteTarget.name}" deleted`);
            setDeleteTarget(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </Card>
  );
}

// ================== BANKS ==================
function BanksMaster() {
  const items = useLive<BankAccount>(() => db().bankAccounts.orderBy("bankName").toArray());
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function fresh(): BankAccount {
    return { id: uid(), bankName: "", accountName: "", accountNo: "", ifsc: "", createdAt: Date.now() };
  }
  async function setDefault(id: string) {
    for (const b of items) await db().bankAccounts.put({ ...b, isDefault: b.id === id });
    toast.success("Default set");
  }
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Store multiple bank accounts; select one per quotation.</div>
        <Button onClick={() => setEditing(fresh())} className="gap-2"><Plus className="h-4 w-4" /> New bank</Button>
      </div>
      {items.length === 0 ? <Empty text="No bank accounts yet" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Bank</TableHead><TableHead>A/C Name</TableHead><TableHead>A/C No.</TableHead><TableHead>IFSC</TableHead><TableHead className="w-40 text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(b => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.bankName} {b.isDefault && <Badge className="ml-2">Default</Badge>}</TableCell>
                <TableCell>{b.accountName}</TableCell>
                <TableCell className="font-mono">{b.accountNo}</TableCell>
                <TableCell className="font-mono">{b.ifsc}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => setDefault(b.id)} title={b.isDefault ? "Unset default" : "Set default"}>
                    {b.isDefault ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ ...b })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget({ id: b.id, name: `${b.bankName} (${b.accountNo})` })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Bank Account</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Bank Name *"><Input value={editing.bankName} onChange={e => setEditing({ ...editing, bankName: e.target.value })} /></F>
              <F label="Account Name *"><Input value={editing.accountName} onChange={e => setEditing({ ...editing, accountName: e.target.value })} /></F>
              <F label="Account No. *"><Input value={editing.accountNo} onChange={e => setEditing({ ...editing, accountNo: e.target.value })} /></F>
              <F label="IFSC *"><Input value={editing.ifsc} onChange={e => setEditing({ ...editing, ifsc: e.target.value })} /></F>
              <F label="Branch"><Input value={editing.branch || ""} onChange={e => setEditing({ ...editing, branch: e.target.value })} /></F>
              <F label="Account Type"><Input placeholder="e.g. Current Account" value={editing.accountType || ""} onChange={e => setEditing({ ...editing, accountType: e.target.value })} /></F>
              <F label="UPI"><Input value={editing.upi || ""} onChange={e => setEditing({ ...editing, upi: e.target.value })} /></F>
              <F label="SWIFT"><Input placeholder="e.g. SBININBB123" value={editing.swift || ""} onChange={e => setEditing({ ...editing, swift: e.target.value })} /></F>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={async () => {
              if (!editing?.bankName || !editing?.accountNo) { toast.error("Bank & account required"); return; }
              await db().bankAccounts.put(editing); setEditing(null); toast.success("Saved");
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title={`Delete bank account "${deleteTarget?.name}"?`}
        description="This bank account will be removed from future quotation selections."
        destructive
        confirmText="Delete Bank"
        isBusy={isDeleting}
        busyText="Deleting..."
        onConfirm={async () => {
          if (!deleteTarget) return;
          setIsDeleting(true);
          try {
            await db().bankAccounts.delete(deleteTarget.id);
            toast.success(`Bank account deleted`);
            setDeleteTarget(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </Card>
  );
}

// ================== QUOTATION TEMPLATES ==================
function TemplatesMaster() {
  const items = useLive<QuotationTemplate>(() => db().quotationTemplates.orderBy("name").toArray());
  const [editing, setEditing] = useState<QuotationTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function fresh(): QuotationTemplate {
    return { id: uid(), name: "New template", accent: "#1e40af", fontFamily: "helvetica", showLogo: true, tableStyle: "grid", createdAt: Date.now() };
  }
  async function setDefault(id: string) {
    for (const t of items) await db().quotationTemplates.put({ ...t, isDefault: t.id === id });
    toast.success("Default set");
  }
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Customize accent colour, font, table style, header/footer per quotation template.</div>
        <div className="flex gap-2">
          <Button onClick={() => setEditing(fresh())} className="gap-2"><Plus className="h-4 w-4" /> New template</Button>
        </div>
      </div>
      {items.length === 0 ? <Empty text="No quotation templates yet — default styling will be used" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Accent</TableHead><TableHead>Font</TableHead><TableHead>Table</TableHead><TableHead className="w-40 text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name} {t.isDefault && <Badge className="ml-2">Default</Badge>}</TableCell>
                <TableCell><span className="inline-block h-4 w-8 rounded" style={{ background: t.accent }} /> <span className="ml-2 font-mono text-xs">{t.accent}</span></TableCell>
                <TableCell className="capitalize">{t.fontFamily}</TableCell>
                <TableCell className="capitalize">{t.tableStyle}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => setDefault(t.id)}>
                    {t.isDefault ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ ...t })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { const dup = { ...t, id: uid(), name: `${t.name} copy`, isDefault: false, createdAt: Date.now() }; db().quotationTemplates.put(dup); toast.success("Duplicated"); }}><Pencil className="h-4 w-4 rotate-45" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget({ id: t.id, name: t.name })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Quotation Template</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Name"><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></F>
              <F label="Accent Colour">
                <div className="flex gap-2">
                  <Input type="color" value={editing.accent} onChange={e => setEditing({ ...editing, accent: e.target.value })} className="w-16 p-1" />
                  <Input value={editing.accent} onChange={e => setEditing({ ...editing, accent: e.target.value })} />
                </div>
              </F>
              <F label="Font Family">
                <Select value={editing.fontFamily} onValueChange={v => setEditing({ ...editing, fontFamily: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="helvetica">Helvetica (modern)</SelectItem>
                    <SelectItem value="times">Times (classic)</SelectItem>
                    <SelectItem value="courier">Courier (mono)</SelectItem>
                  </SelectContent>
                </Select>
              </F>
              <F label="Table Style">
                <Select value={editing.tableStyle} onValueChange={v => setEditing({ ...editing, tableStyle: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="grid">Grid</SelectItem>
                    <SelectItem value="striped">Striped</SelectItem>
                    <SelectItem value="plain">Plain</SelectItem>
                  </SelectContent>
                </Select>
              </F>
              <div className="col-span-2 flex items-center gap-2">
                <Checkbox checked={editing.showLogo} onCheckedChange={v => setEditing({ ...editing, showLogo: !!v })} />
                <Label className="text-sm">Show logo in header</Label>
              </div>
              <F label="Header text (optional)"><Input value={editing.headerText || ""} onChange={e => setEditing({ ...editing, headerText: e.target.value })} /></F>
              <F label="Footer text (optional)"><Input value={editing.footerText || ""} onChange={e => setEditing({ ...editing, footerText: e.target.value })} placeholder="Built by MMA" /></F>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={async () => { if (editing) { await db().quotationTemplates.put(editing); setEditing(null); toast.success("Saved"); } }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title={`Delete quotation template "${deleteTarget?.name}"?`}
        description="This quotation design template will be permanently removed from presets."
        destructive
        confirmText="Delete Template"
        isBusy={isDeleting}
        busyText="Deleting..."
        onConfirm={async () => {
          if (!deleteTarget) return;
          setIsDeleting(true);
          try {
            await db().quotationTemplates.delete(deleteTarget.id);
            toast.success(`Template "${deleteTarget.name}" deleted`);
            setDeleteTarget(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </Card>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

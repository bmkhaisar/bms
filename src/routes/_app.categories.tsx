import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Category } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/categories")({
  head: () => ({ meta: [{ title: "Categories — Business Management" }] }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const rows = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return (
    <AppShell title="Categories">
      <PageHeader title="Product Categories" actions={<Button onClick={() => { setEditId(null); setName(""); setOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> Add</Button>} />
      <Card className="card-soft overflow-hidden">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="w-24 text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">No categories yet.</TableCell></TableRow>}
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditId(r.id); setName(r.name); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit category" : "Add category"}</DialogTitle></DialogHeader>
          <Input placeholder="Category name" value={name} onChange={e => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (!name.trim()) { toast.error("Name required"); return; }
              await db().categories.put({ id: editId ?? uid(), name: name.trim(), createdAt: Date.now() });
              toast.success("Saved"); setOpen(false);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)} title="Delete category?" destructive confirmText="Delete" onConfirm={async () => { if (deleteId) { await db().categories.delete(deleteId); toast.success("Deleted"); } }} />
    </AppShell>
  );
}

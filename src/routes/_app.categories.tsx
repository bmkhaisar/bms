import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Category } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, onValue, off, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, cacheEntitiesBulk, getCachedEntities, removeCachedEntity } from "@/modules/sync/dexieCache";

export const Route = createFileRoute("/_app/categories")({
  head: () => ({ meta: [{ title: "Categories — BMS NEXT" }] }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const [cloudRows, setCloudRows] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeCompany?.id || !user?.uid) return;

    let active = true;

    // Load from Dexie cache immediately
    getCachedEntities<Category>({
      uid: user.uid,
      companyId: activeCompany.id,
      entityType: "category",
    }).then((cached) => {
      if (active && cached.length > 0) {
        setCloudRows(cached);
      }
    });

    if (!firebaseDb) return;

    const catRef = ref(firebaseDb, `companyData/${activeCompany.id}/categories`);
    const onData = (snap: any) => {
      if (!active) return;
      if (snap.exists()) {
        const val = snap.val();
        const list: Category[] = Object.values(val);
        setCloudRows(list);

        // Update Dexie cache in background
        cacheEntitiesBulk(
          list.map((c) => ({
            uid: user.uid,
            companyId: activeCompany.id,
            entityType: "category",
            entityId: c.id,
            data: c,
          }))
        );

        // Update local legacy Dexie store
        for (const c of list) {
          db().categories.put(c);
        }
      } else {
        setCloudRows([]);
      }
    };

    onValue(catRef, onData);

    return () => {
      active = false;
      off(catRef, "value", onData);
    };
  }, [activeCompany?.id, user?.uid]);

  const rows = activeCompany?.id && cloudRows.length > 0 ? cloudRows : dexieRows;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Category name is required");
      return;
    }

    setSaving(true);
    try {
      const id = editId ?? uid();
      const catToSave: Category = {
        id,
        name: trimmed,
        createdAt: Date.now(),
      };

      if (activeCompany?.id && firebaseDb) {
        const catRef = ref(firebaseDb, `companyData/${activeCompany.id}/categories/${id}`);
        await set(catRef, sanitizeForFirebase(catToSave));
      }

      if (activeCompany?.id && user?.uid) {
        await cacheEntity({
          uid: user.uid,
          companyId: activeCompany.id,
          entityType: "category",
          entityId: id,
          data: catToSave,
        });
      }

      await db().categories.put(catToSave);
      toast.success("Category saved");
      setOpen(false);
    } catch (err) {
      console.error("Failed to save category:", err);
      toast.error("Unable to save category");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      if (activeCompany?.id && firebaseDb) {
        const catRef = ref(firebaseDb, `companyData/${activeCompany.id}/categories/${id}`);
        await rtdbRemove(catRef);
      }
      if (activeCompany?.id) {
        await removeCachedEntity({
          companyId: activeCompany.id,
          entityType: "category",
          entityId: id,
        });
      }
      await db().categories.delete(id);
      toast.success("Category deleted");
    } catch (err) {
      console.error("Failed to delete category:", err);
      toast.error("Unable to delete category");
    }
  }

  return (
    <AppShell title="Categories">
      <PageHeader
        title="Product Categories"
        description="Organize products into hierarchical inventory groups."
        actions={
          <Button
            onClick={() => {
              setEditId(null);
              setName("");
              setOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Add category
          </Button>
        }
      />
      <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  No categories yet. Click "Add category" to organize your inventory.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditId(r.id);
                      setName(r.name);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              placeholder="Category name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete category?"
        description="Products belonging to this category will not be deleted, but will become unassigned."
        destructive
        confirmText="Delete"
        onConfirm={async () => {
          if (deleteId) await remove(deleteId);
        }}
      />
    </AppShell>
  );
}

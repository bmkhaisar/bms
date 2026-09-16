import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Category } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, removeCachedEntity } from "@/modules/sync/dexieCache";
import { performOptimisticMutation } from "@/lib/mutationPipeline";

export const Route = createFileRoute("/_app/categories")({
  head: () => ({ meta: [{ title: "Categories — BMS NEXT" }] }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const [, setCloudRows] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);

  // The company-level ordered realtime synchronizer is the single read owner.
  const rows = dexieRows;

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

      const isNew = !editId;

      await performOptimisticMutation<Category>({
        entityType: "category",
        entityId: id,
        action: isNew ? "create" : "update",
        companyId: activeCompany?.id,
        uid: user?.uid,
        optimisticData: catToSave,
        onOptimistic: () => {
          setCloudRows((prev) => {
            const exists = prev.some((c) => c.id === id);
            if (exists) {
              return prev.map((c) => (c.id === id ? catToSave : c));
            } else {
              return [...prev, catToSave].sort((a, b) => a.name.localeCompare(b.name));
            }
          });
        },
        onRollback: (prev) => {
          setCloudRows((prevList) => {
            if (isNew) {
              return prevList.filter((c) => c.id !== id);
            } else if (prev) {
              return prevList.map((c) => (c.id === prev.id ? prev : c));
            }
            return prevList;
          });
        },
        syncDexie: async () => {
          await db().categories.put(catToSave);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "category",
              entityId: id,
              data: catToSave,
            });
          }
        },
        rollbackDexie: async (prev) => {
          if (isNew) {
            await db().categories.delete(id);
            if (activeCompany?.id) {
              await removeCachedEntity({ companyId: activeCompany.id, entityType: "category", entityId: id });
            }
          } else if (prev) {
            await db().categories.put(prev);
          }
        },
        serverMutation: async () => {
          if (activeCompany?.id && firebaseDb) {
            const catRef = ref(firebaseDb, `companyData/${activeCompany.id}/categories/${id}`);
            await set(catRef, sanitizeForFirebase(catToSave));
          }
        },
        queryKeys: [["categories", activeCompany?.id]],
        successToast: isNew ? "Category created" : "Category updated",
        errorToast: "Unable to save category",
      });

      setOpen(false);
    } catch (err) {
      console.error("Failed to save category:", err);
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(category: Category) {
    const id = category.id;
    await performOptimisticMutation<Category>({
      entityType: "category",
      entityId: id,
      action: "delete",
      companyId: activeCompany?.id,
      uid: user?.uid,
      capturePreviousState: () => category,
      onOptimistic: () => {
        // Immediate UI removal
        setCloudRows((prev) => prev.filter((c) => c.id !== id));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => [...list, prev].sort((a, b) => a.name.localeCompare(b.name)));
        }
      },
      syncDexie: async () => {
        await db().categories.delete(id);
        if (activeCompany?.id) {
          await removeCachedEntity({
            companyId: activeCompany.id,
            entityType: "category",
            entityId: id,
          });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().categories.put(prev);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "category",
              entityId: prev.id,
              data: prev,
            });
          }
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          const catRef = ref(firebaseDb, `companyData/${activeCompany.id}/categories/${id}`);
          await rtdbRemove(catRef);
        }
      },
      queryKeys: [["categories", activeCompany?.id]],
      successToast: "Category deleted",
      errorToast: "Couldn't delete category. It has been restored.",
    });
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
            className="gap-2 shadow-sm"
          >
            <Plus className="h-4 w-4" /> Add category
          </Button>
        }
      />
      <Card className="rounded-2xl border border-border/80 bg-card shadow-soft overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/30 text-[11px] font-semibold text-muted-foreground uppercase border-b border-border/70">
              <TableHead>Name</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-xs text-muted-foreground">
                  No categories yet. Click 'Add category' to create your first product category.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-xs">{r.name}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Edit Category"
                        onClick={() => {
                          setEditId(r.id);
                          setName(r.name);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        title="Delete Category"
                        onClick={() => setDeleteTarget(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
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
          <DialogFooter className="gap-2 sm:gap-0 mt-3">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving} className="text-xs">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="text-xs">
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Products belonging to this category will not be deleted, but will become unassigned."
        destructive
        confirmText="Delete Category"
        busyText="Deleting…"
        onConfirm={async () => {
          if (deleteTarget) await removeCategory(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </AppShell>
  );
}

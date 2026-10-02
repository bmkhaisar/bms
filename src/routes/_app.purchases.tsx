import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { DocumentListPage } from "@/components/app/DocumentListPage";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShoppingCart, FileSpreadsheet, PackagePlus, Clock, BookOpen } from "lucide-react";
import type { Purchase, PurchaseOrder } from "@/lib/db";
import { PurchaseOrdersView } from "@/modules/purchase/components/PurchaseOrdersView";
import { PurchaseGrnView } from "@/modules/purchase/components/PurchaseGrnView";
import { PendingPurchaseOrderBook } from "@/modules/purchase/components/PendingPurchaseOrderBook";
import { PurchaseRegisterView } from "@/modules/purchase/components/PurchaseRegisterView";

export const Route = createFileRoute("/_app/purchases")({
  head: () => ({ meta: [{ title: "Purchases & Procurement — BMS NEXT" }] }),
  component: PurchasesHubPage,
});

function PurchasesHubPage() {
  const [activeTab, setActiveTab] = useState("invoices");
  const [targetPoForGrn, setTargetPoForGrn] = useState<PurchaseOrder | null>(null);

  const handleConvertToGrn = (po: PurchaseOrder) => {
    setTargetPoForGrn(po);
    setActiveTab("grn");
  };

  return (
    <AppShell title="Purchases & Procurement">
      <div className="animate-fade-in space-y-4">
        <div className="mb-2">
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Procurement & Purchase Hub
          </h2>
          <p className="text-xs text-muted-foreground">
            Complete lifecycle management: Purchase Orders, Goods Receipt Notes (GRN), Purchase Invoices, and Statutory Registers.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="w-full overflow-x-auto scrollbar-thin pb-1">
            <TabsList className="inline-flex w-auto min-w-full sm:min-w-0 h-10 items-center justify-start gap-1 p-1 bg-secondary/50 rounded-xl whitespace-nowrap">
              <TabsTrigger value="invoices" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>Purchase Bills</span>
              </TabsTrigger>
              <TabsTrigger value="orders" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Purchase Orders (PO)</span>
              </TabsTrigger>
              <TabsTrigger value="grn" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <PackagePlus className="h-3.5 w-3.5" />
                <span>Goods Receipt Notes (GRN)</span>
              </TabsTrigger>
              <TabsTrigger value="pending-po" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Pending PO Book</span>
              </TabsTrigger>
              <TabsTrigger value="register" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                <span>Purchase Register</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="invoices" className="mt-0">
            <DocumentListPage<Purchase>
              kind="purchase"
              title="Purchase Invoices"
              addLabel="New purchase bill"
              tableFor="supplier"
            />
          </TabsContent>

          <TabsContent value="orders" className="mt-0">
            <PurchaseOrdersView onConvertToGrn={handleConvertToGrn} />
          </TabsContent>

          <TabsContent value="grn" className="mt-0">
            <PurchaseGrnView
              initialPo={targetPoForGrn}
              onClearInitialPo={() => setTargetPoForGrn(null)}
            />
          </TabsContent>

          <TabsContent value="pending-po" className="mt-0">
            <PendingPurchaseOrderBook />
          </TabsContent>

          <TabsContent value="register" className="mt-0">
            <PurchaseRegisterView />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

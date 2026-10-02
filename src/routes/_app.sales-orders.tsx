import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShoppingBag, BookOpen, Clock, FileSpreadsheet } from "lucide-react";
import { SalesOrdersView } from "@/modules/sales/components/SalesOrdersView";
import { SalesOrderBookView } from "@/modules/sales/components/SalesOrderBookView";
import { PendingSalesOrderBook } from "@/modules/sales/components/PendingSalesOrderBook";

export const Route = createFileRoute("/_app/sales-orders")({
  head: () => ({ meta: [{ title: "Sales Orders — BMS NEXT" }] }),
  component: SalesOrdersHubPage,
});

function SalesOrdersHubPage() {
  const [activeTab, setActiveTab] = useState("orders");

  return (
    <AppShell title="Sales Orders">
      <div className="animate-fade-in space-y-4">
        <div className="mb-2">
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Sales Order Hub
          </h2>
          <p className="text-xs text-muted-foreground">
            End-to-end sales order processing: Confirm customer orders, track fulfillment pipeline, inspect pending order books, and convert directly to GST invoices.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="w-full overflow-x-auto scrollbar-thin pb-1">
            <TabsList className="inline-flex w-auto min-w-full sm:min-w-0 h-10 items-center justify-start gap-1 p-1 bg-secondary/50 rounded-xl whitespace-nowrap">
              <TabsTrigger value="orders" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <ShoppingBag className="h-3.5 w-3.5" />
                <span>Sales Orders</span>
              </TabsTrigger>
              <TabsTrigger value="order-book" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                <span>Sales Order Book</span>
              </TabsTrigger>
              <TabsTrigger value="pending-so" className="gap-1.5 text-xs font-medium px-3 py-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Pending Sales Order Book</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="orders" className="mt-0 focus-visible:outline-hidden">
            <SalesOrdersView />
          </TabsContent>

          <TabsContent value="order-book" className="mt-0 focus-visible:outline-hidden">
            <SalesOrderBookView />
          </TabsContent>

          <TabsContent value="pending-so" className="mt-0 focus-visible:outline-hidden">
            <PendingSalesOrderBook />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, BookOpen, Calendar, Scale, FolderTree, ChevronDown } from "lucide-react";
import { useAccounting } from "@/modules/accounting/useAccounting";
import { DayBookView } from "@/modules/accounting/components/DayBookView";
import { LedgerStatementView } from "@/modules/accounting/components/LedgerStatementView";
import { TrialBalanceView } from "@/modules/accounting/components/TrialBalanceView";
import { ChartOfAccountsView } from "@/modules/accounting/components/ChartOfAccountsView";
import { VoucherEntryModal } from "@/modules/accounting/components/VoucherEntryModal";
import type { VoucherType } from "@/modules/accounting/types";
import { ListSkeleton } from "@/components/app/Skeletons";

export const Route = createFileRoute("/_app/ledger")({
  head: () => ({ meta: [{ title: "Accounting Engine — BMS NEXT" }] }),
  component: AccountingPage,
});

function AccountingPage() {
  const {
    vouchers,
    ledgers,
    accountGroups,
    loading,
    postVoucher,
    reverseVoucher,
    manageLedger,
    manageGroup,
    initChart,
    activeFinancialYear,
  } = useAccounting();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<VoucherType>("journal");
  const [activeTab, setActiveTab] = useState("daybook");

  const openVoucherModal = (type: VoucherType) => {
    setModalType(type);
    setModalOpen(true);
  };

  return (
    <AppShell title="Accounting Hub">
      <div className="animate-fade-in space-y-4">
        <PageHeader
          title="General Ledger & Accounting"
          description={`Double-entry financial backbone for company accounts. Financial Year: ${
            activeFinancialYear?.name || "Active"
          }`}
          actions={
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    <span>New Voucher</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 text-xs">
                  <DropdownMenuItem onClick={() => openVoucherModal("journal")}>
                    Journal Voucher (JV)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openVoucherModal("payment")}>
                    Payment Voucher (PAY)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openVoucherModal("receipt")}>
                    Receipt Voucher (REC)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openVoucherModal("contra")}>
                    Contra Voucher (CON)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="w-full flex-wrap justify-start gap-1 p-1 h-auto">
            <TabsTrigger value="daybook" className="gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Day Book</span>
            </TabsTrigger>
            <TabsTrigger value="statement" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              <span>Ledger Statement</span>
            </TabsTrigger>
            <TabsTrigger value="trialbalance" className="gap-1.5">
              <Scale className="h-3.5 w-3.5" />
              <span>Trial Balance</span>
            </TabsTrigger>
            <TabsTrigger value="chart" className="gap-1.5">
              <FolderTree className="h-3.5 w-3.5" />
              <span>Chart of Accounts</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daybook">
            {loading && vouchers.length === 0 ? (
              <ListSkeleton columns={6} rows={6} />
            ) : (
              <DayBookView vouchers={vouchers} onReverse={reverseVoucher} />
            )}
          </TabsContent>

          <TabsContent value="statement">
            {loading && ledgers.length === 0 ? (
              <ListSkeleton columns={5} rows={6} />
            ) : (
              <LedgerStatementView ledgers={ledgers} vouchers={vouchers} />
            )}
          </TabsContent>

          <TabsContent value="trialbalance">
            <TrialBalanceView
              ledgers={ledgers}
              accountGroups={accountGroups}
              vouchers={vouchers}
              loading={loading}
            />
          </TabsContent>

          <TabsContent value="chart">
            {loading && ledgers.length === 0 ? (
              <ListSkeleton columns={4} rows={6} />
            ) : (
              <ChartOfAccountsView
                ledgers={ledgers}
                accountGroups={accountGroups}
                vouchers={vouchers}
                onCreateLedger={manageLedger}
                onCreateGroup={manageGroup}
                onInitChart={initChart}
              />
            )}
          </TabsContent>
        </Tabs>

        {/* Double-entry voucher modal */}
        <VoucherEntryModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          defaultType={modalType}
          ledgers={ledgers}
          onPost={postVoucher}
        />
      </div>
    </AppShell>
  );
}

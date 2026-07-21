import { EnterpriseWorkflowPage } from '../components/workflow/EnterpriseWorkflowPage'

export function WorkflowListPage({ kind }: { kind: 'invoices' | 'orders' | 'purchase-orders' }) {
  return <EnterpriseWorkflowPage kind={kind} />
}

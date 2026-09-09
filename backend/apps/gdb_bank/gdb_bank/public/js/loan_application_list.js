// Desk list: show lending's actual status (Open/Approved/Rejected) as the
// row indicator instead of the default docstatus pill, which reads
// "Submitted" for every submitted document regardless of decision.
frappe.listview_settings['Loan Application'] = Object.assign(
  frappe.listview_settings['Loan Application'] || {},
  {
    add_fields: ['status'],
    get_indicator(doc) {
      const colors = { Open: 'blue', Approved: 'green', Rejected: 'red' };
      return [__(doc.status), colors[doc.status] || 'gray', 'status,=,' + doc.status];
    },
  }
);

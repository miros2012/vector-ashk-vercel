const CONFIRMED_TYPES = [
  'ADVANCE',
  'OFFICIAL_PAYMENT',
  'STATUTORY_DEDUCTION',
  'OTHER_CONFIRMED_INDIVIDUAL'
];

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.000001;
}

export function reconcileMasterPayroll({ gross, evidence, requiredBlockedTypes = [] }) {
  const grossMasters = Array.isArray(gross?.masters) ? gross.masters : [];
  const confirmed = Array.isArray(evidence?.confirmed) ? evidence.confirmed : [];
  const blocked = Array.isArray(evidence?.blocked) ? evidence.blocked : [];
  const grossMasterKeys = new Set(grossMasters.map((master) => master.masterKey));
  const unmatchedEvidenceMasterKeys = [
    ...new Set(
      confirmed
        .map((item) => item?.masterKey)
        .filter((masterKey) => masterKey && !grossMasterKeys.has(masterKey))
    )
  ].sort();

  const evidenceByMaster = new Map();
  for (const item of confirmed) {
    if (!evidenceByMaster.has(item.masterKey)) evidenceByMaster.set(item.masterKey, []);
    evidenceByMaster.get(item.masterKey).push(item);
  }

  const masters = grossMasters.map((master) => {
    const items = evidenceByMaster.get(master.masterKey) ?? [];
    const byType = Object.fromEntries(CONFIRMED_TYPES.map((type) => [type, 0]));
    for (const item of items) {
      if (CONFIRMED_TYPES.includes(item.type)) byType[item.type] += Number(item.amount || 0);
    }

    const confirmedDeductions = sum(Object.values(byType));
    const outstandingNet = Number(master.gross || 0) - confirmedDeductions;
    const status = outstandingNet < 0 ? 'REVIEW_REQUIRED' : 'INTERIM';

    return {
      ...master,
      advances: byType.ADVANCE,
      officialPayments: byType.OFFICIAL_PAYMENT,
      statutoryDeductions: byType.STATUTORY_DEDUCTION,
      otherConfirmedDeductions: byType.OTHER_CONFIRMED_INDIVIDUAL,
      confirmedDeductions,
      outstandingNet,
      status
    };
  });

  const calculatedGross = sum(masters.map((master) => master.gross));
  const reportedGross = Number(gross?.totals?.gross ?? calculatedGross);
  const confirmedDeductions = sum(masters.map((master) => master.confirmedDeductions));
  const outstandingNet = sum(masters.map((master) => master.outstandingNet));
  const blockedTotal = sum(blocked.map((item) => item.amount));

  const required = new Set(requiredBlockedTypes);
  const requiredBlockedRemain = blocked.some((item) => required.has(item.type));
  const evidenceRowsValid = confirmed.every((item) =>
    item?.status === 'CONFIRMED' &&
    item?.masterKey &&
    item?.sourceId &&
    Number.isFinite(Number(item.amount)) &&
    Number(item.amount) >= 0
  );
  const uniqueEvidenceIds = new Set(confirmed.map((item) => item.sourceId)).size === confirmed.length;

  const gates = {
    ASHK_ARCHIVE_OK: gross?.archiveVerification === 'OK',
    ALL_SESSION_TYPES_RATED: (gross?.blockers?.length ?? 0) === 0,
    PER_MASTER_EQUALS_AGGREGATE: nearlyEqual(calculatedGross, reportedGross),
    EVENT_BASED_RULES_OK: gross?.eventBasedRulesOk !== false,
    EVIDENCE_RECONCILED:
      evidenceRowsValid && uniqueEvidenceIds && unmatchedEvidenceMasterKeys.length === 0,
    NO_UNEXPLAINED_NEGATIVE_NET: masters.every((master) => master.outstandingNet >= 0),
    VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED:
      !requiredBlockedRemain || evidence?.vehicleAllocationsExcluded === true,
    EXISTING_PAYOUTS_RECONCILED: evidence?.existingPayoutsReconciled === true
  };

  const promotionStatus = Object.values(gates).every(Boolean) ? 'READY' : 'BLOCKED';
  const finalMasters = masters.map((master) => ({
    ...master,
    status: master.status === 'REVIEW_REQUIRED'
      ? 'REVIEW_REQUIRED'
      : promotionStatus === 'READY' ? 'READY' : 'INTERIM'
  }));

  return {
    masters: finalMasters,
    totals: {
      gross: reportedGross,
      confirmedDeductions,
      outstandingNet,
      blocked: blockedTotal
    },
    blocked,
    unmatchedEvidenceMasterKeys,
    gates,
    promotionStatus
  };
}

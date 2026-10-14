// Original Settings rule copy (titles, descriptions, region relevance, section layout), restored verbatim from the original
// Settings workspace. The `defaultValue` the original pre-selected is NOT an assertion: the restored page shows "Not configured"
// until the company has actually recorded an answer, and shows the catalogue default only as a note (see adapter.ts).

export type RuleValue = "applies" | "does-not-apply" | "not-configured"

export type Rule = {
  id: string
  title: string
  description: string
  appliesTo?: "canada" | "us" | "both"
  defaultValue?: RuleValue
}
export const RULES: Record<string, Rule[]> = {
  cargo: [
    {
      id: "dg_canada",
      title: "Dangerous goods in Canada",
      description:
        "Generate dangerous-goods compliance requirements when this company transports regulated goods in Canada.",
      appliesTo: "canada",
      defaultValue: "applies",
    },
    {
      id: "dg_us",
      title: "Hazardous materials in the United States",
      description:
        "Generate hazardous-material compliance requirements for US operations.",
      appliesTo: "us",
      defaultValue: "applies",
    },
    {
      id: "dg_wv_nv",
      title: "Dangerous goods in West Virginia or Nevada",
      description:
        "Use the additional state-specific routing and documentation rules when applicable.",
      appliesTo: "us",
    },
    {
      id: "dg_colorado",
      title: "Dangerous goods in Colorado",
      description:
        "Apply Colorado-specific dangerous-goods routing and compliance requirements.",
      appliesTo: "us",
    },
    {
      id: "dg_idaho",
      title: "Dangerous goods in Idaho",
      description:
        "Apply Idaho-specific dangerous-goods routing and compliance requirements.",
      appliesTo: "us",
    },
    {
      id: "tobacco_ontario",
      title: "Tobacco transport in Ontario",
      description:
        "Generate Ontario tobacco permit and documentation alerts when this operation applies.",
      appliesTo: "canada",
    },
    {
      id: "alcohol_us",
      title: "Alcohol transport in the United States",
      description:
        "Enable US alcohol-transport compliance checks for this company.",
      appliesTo: "us",
    },
    {
      id: "alcohol_nj",
      title: "Alcohol transport in New Jersey",
      description:
        "Apply New Jersey-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_tx",
      title: "Alcohol transport in Texas",
      description:
        "Apply Texas-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_ky",
      title: "Alcohol transport in Kentucky",
      description:
        "Apply Kentucky-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_in",
      title: "Alcohol transport in Indiana",
      description:
        "Apply Indiana-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_oh",
      title: "Alcohol transport in Ohio",
      description:
        "Apply Ohio-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
    {
      id: "alcohol_ny",
      title: "Alcohol transport in New York",
      description:
        "Apply New York-specific alcohol transportation requirements.",
      appliesTo: "us",
    },
  ],

  operations: [
    {
      id: "reefer_california",
      title: "Refrigerated operations in California",
      description:
        "Generate California-specific refrigerated-equipment compliance alerts.",
      appliesTo: "us",
    },
  ],

  tax: [
    {
      id: "ifta",
      title: "IFTA",
      description:
        "Applies when this company is subject to IFTA. Filing frequency, account details, mileage, fuel, and period activity belong on the Tax Filing page.",
      appliesTo: "both",
    },
    {
      id: "ct_huf",
      title: "Connecticut Highway Use Fee",
      description:
        "Applies when Connecticut Highway Use Fee requirements apply to this company.",
      appliesTo: "us",
    },
    {
      id: "ny_hut",
      title: "New York Highway Use Tax",
      description:
        "Applies when New York HUT requirements apply to this company. Credential and filing details are handled on the Tax Filing page.",
      appliesTo: "us",
    },
    {
      id: "kyu",
      title: "Kentucky Weight Distance Tax / KYU",
      description:
        "Applies when Kentucky KYU requirements apply to this company.",
      appliesTo: "us",
    },
    {
      id: "nm_wdt",
      title: "New Mexico Weight Distance Tax",
      description:
        "Applies when New Mexico Weight Distance Tax requirements apply to this company.",
      appliesTo: "us",
    },
    {
      id: "or_wmt",
      title: "Oregon Weight-Mile Tax",
      description:
        "Applies when Oregon Weight-Mile Tax requirements apply to this company. Temporary-permit versus permanent-account logic belongs on the Tax Filing page.",
      appliesTo: "us",
    },
    {
      id: "form_2290",
      title: "Federal Heavy Highway Vehicle Use Tax — Form 2290",
      description:
        "Applies when Form 2290 is part of this company's US tax compliance. Vehicle-specific taxable-unit logic belongs to Vehicle and Tax Filing records.",
      appliesTo: "us",
    },
    {
      id: "fuel_charge_registration",
      title: "Fuel Charge Registration",
      description:
        "Applies when a Fuel Charge Registration obligation must be retained or handled for this company, including outstanding historical obligations.",
      appliesTo: "canada",
    },
    {
      id: "texas_excise_tax",
      title: "Texas Excise Tax",
      description:
        "Applies when Texas excise or separate fuel-tax requirements apply to this company.",
      appliesTo: "us",
    },
    {
      id: "arkansas_motor_fuel_tax",
      title: "Arkansas Motor Fuel Tax",
      description:
        "Applies when Arkansas motor-fuel tax requirements apply to this company. TES keeps this record even when most activity is reported through IFTA.",
      appliesTo: "us",
    },
    {
      id: "ontario_tobacco_tax",
      title: "Ontario Tobacco Tax",
      description:
        "Applies when this company is subject to Ontario Tobacco Tax requirements.",
      appliesTo: "canada",
    },
  ],

  drivers: [
    {
      id: "background_check",
      title: "Background check",
      description:
        "Require background-check completion before the driver can be treated as compliant.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "annual_road_test",
      title: "Annual road test",
      description:
        "Flag missing annual road-test documentation for applicable drivers.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "pre_employment_road_test",
      title: "Pre-employment road test",
      description:
        "Require road-test documentation during driver onboarding.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "psp",
      title: "PSP screening",
      description:
        "Require Pre-Employment Screening Program checks for applicable US driver operations.",
      appliesTo: "us",
    },
    {
      id: "canadian_drug_alcohol",
      title: "Drug & alcohol testing for Canadian drivers",
      description:
        "Apply the company's Canadian drug and alcohol testing requirements.",
      appliesTo: "canada",
      defaultValue: "applies",
    },
    {
      id: "tax_documents",
      title: "Driver tax documents",
      description:
        "Generate document alerts when required tax or payroll documentation is missing.",
      appliesTo: "both",
      defaultValue: "applies",
    },
    {
      id: "work_permit",
      title: "Work permit",
      description:
        "Track work-permit documentation and expiration dates for applicable personnel.",
      appliesTo: "both",
    },
    {
      id: "permanent_resident_card",
      title: "Permanent resident card",
      description:
        "Track permanent-resident documentation when it is required for the company's operations.",
      appliesTo: "both",
    },
    {
      id: "staff_incorporation",
      title: "Staff incorporation documents",
      description:
        "Require incorporation documentation for applicable owner-operators or subcontractors.",
      appliesTo: "both",
    },
    {
      id: "passport_us",
      title: "Passport for US operations",
      description:
        "Generate passport-document alerts for personnel who require them for cross-border operations.",
      appliesTo: "us",
      defaultValue: "applies",
    },
    {
      id: "visa_us",
      title: "Visa for US operations",
      description:
        "Track visa documentation and expiry dates when required for US operations.",
      appliesTo: "us",
    },
  ],

  programs: [
    {
      id: "ctpat",
      title: "CTPAT",
      description:
        "Identify the company as participating in the Customs-Trade Partnership Against Terrorism program.",
      appliesTo: "us",
    },
    {
      id: "fast",
      title: "FAST",
      description:
        "Identify participation in the Free and Secure Trade program.",
      appliesTo: "both",
    },
    {
      id: "pip",
      title: "PIP",
      description:
        "Identify participation in Canada's Partners in Protection program.",
      appliesTo: "canada",
    },
    {
      id: "csa",
      title: "Customs Self Assessment",
      description:
        "Identify participation in the Customs Self Assessment program.",
      appliesTo: "canada",
    },
    {
      id: "smartway",
      title: "EPA SmartWay",
      description:
        "Identify participation in the EPA SmartWay program.",
      appliesTo: "us",
    },
    {
      id: "cor",
      title: "COR",
      description:
        "Identify participation in a Certificate of Recognition safety program.",
      appliesTo: "canada",
    },
    {
      id: "pic",
      title: "Partners in Compliance",
      description:
        "Identify participation in the applicable Partners in Compliance program.",
      appliesTo: "canada",
    },
    {
      id: "weight_to_go",
      title: "Weight to Go",
      description:
        "Identify participation in the applicable weight enforcement program.",
      appliesTo: "canada",
    },
    {
      id: "premium_carrier",
      title: "Premium carrier designation",
      description:
        "Use this internal designation when the company should receive the associated premium-carrier treatment.",
      appliesTo: "both",
    },
  ],
}

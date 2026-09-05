import type { EventType, SemanticState } from "@/types/drivers";
import { JURISDICTIONS } from "@/lib/jurisdictions";

export type PerformanceFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "time"
  | "boolean"
  | "select";

export interface ControlledOption { value: string; label: string }

export type PerformanceValueType = "string" | "number" | "boolean" | "date" | "time" | "duration" | "measurement";

export type PerformanceApplicabilityState = "REQUIRED" | "OPTIONAL" | "HIDDEN" | "NOT_APPLICABLE" | "CONDITIONAL";

export interface PerformanceApplicabilityRule {
  state: PerformanceApplicabilityState;
  when?: Readonly<Record<string, readonly string[]>>;
}

export interface PerformanceRelationshipDefinition {
  key: string;
  entityType: string;
  label: string;
  applicability: readonly PerformanceApplicabilityRule[];
  canonical?: boolean;
  operationalReferenceType?: string;
}

export interface PerformanceSourcePolicy {
  allowedOrigins: readonly string[];
  defaultOrigin: string;
  authoritativeSourceTypes: readonly ControlledOption[];
  reporterApplicability?: readonly ControlledOption[];
  deriveAuthoritativeSource?: string;
}

export type PerformanceStepKey =
  | "CATEGORY"
  | "OCCURRENCE"
  | "FACTS"
  | "RELATIONSHIPS"
  | "EVIDENCE"
  | "REVIEW";

export interface PerformanceStepDefinition {
  key: PerformanceStepKey;
  label: string;
  applicability?: readonly PerformanceApplicabilityRule[];
}

export interface PerformancePolicyDefinition {
  evidenceRequired?: boolean;
  verification: "DERIVED" | "REVIEW_ACTION" | "NOT_APPLICABLE";
  lifecycle: "DERIVED" | "NOT_APPLICABLE";
  followUp?: "EXPLICIT" | "DERIVED" | "NOT_APPLICABLE";
  ingestion: "DOCUMENT_FIRST_CAPABLE" | "MANUAL_FALLBACK" | "SYSTEM_SOURCE";
  sourcePolicy?: PerformanceSourcePolicy;
  steps?: readonly PerformanceStepDefinition[];
}

export interface PerformanceFieldDefinition {
  key: string;
  dataPointId: string;
  valueType: PerformanceValueType;
  label: string;
  kind: PerformanceFieldKind;
  required?: boolean;
  options?: readonly ControlledOption[];
  placeholder?: string;
  helpText?: string;
  unit?: string;
  unitOptions?: readonly string[];
  optionsWhen?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  visibleWhen?: Readonly<Record<string, readonly string[]>>;
  unitInput?: boolean;
  applicability?: readonly PerformanceApplicabilityRule[];
}

export interface PerformanceCategoryDefinition {
  code: string;
  value: EventType;
  label: string;
  description: string;
  group: "Safety" | "Regulatory" | "Operations" | "Customer" | "Security" | "Positive" | "HOS / Telematics";
  sources: readonly string[];
  evidenceRequired: boolean;
  determinationTypes: readonly string[];
  analyticsEligible: boolean;
  positiveEligible: boolean;
  temporalBehavior: "Occurrence" | "Measured Interval" | "Lifecycle";
  usesSeverity?: boolean;
  usesStatus?: boolean;
  fields: readonly PerformanceFieldDefinition[];
  relationships?: readonly PerformanceRelationshipDefinition[];
  policy?: PerformancePolicyDefinition;
}


const CONTROLLED = {
  oosType: ["DRIVER", "VEHICLE", "HAZMAT", "BRAKE", "WEIGHT", "EQUIPMENT", "OTHER", "UNKNOWN"],
  deviceType: ["ELD", "CAMERA", "GPS", "TELEMATICS_SENSOR", "ECU", "MOBILE_DEVICE", "OTHER", "UNKNOWN"],
  anomalyType: ["DATA_GAP", "INVALID_LOG", "CLOCK_ERROR", "LOCATION_ANOMALY", "DRIVER_ID_MISMATCH", "DUPLICATE_DATA", "OTHER", "UNKNOWN"],
  interferenceMethod: ["NONE_REPORTED", "CONFIGURATION_CHANGE", "POWER_DISCONNECT", "COMMUNICATION_BLOCK", "PHYSICAL_INTERFERENCE", "SOFTWARE_INTERFERENCE", "UNKNOWN"],
  dataImpact: ["NONE", "PARTIAL_DATA_LOSS", "COMPLETE_DATA_LOSS", "DATA_CORRUPTION", "UNAVAILABLE_FOR_REVIEW", "UNKNOWN"],
  fitnessState: ["NO_RESTRICTION_RECORDED", "RESTRICTION_APPLIES", "TEMPORARILY_UNFIT", "FIT_WITH_RESTRICTIONS", "RETURN_TO_DUTY_PENDING", "RETURN_TO_DUTY_CLEARED", "UNKNOWN", "PENDING_VERIFICATION"],
  serviceType: ["DELIVERY", "PICKUP", "LINEHAUL", "LOCAL", "DEDICATED", "EXPEDITED", "OTHER", "UNKNOWN"],
  notificationState: ["NOT_REQUIRED", "NOT_SENT", "SENT", "FAILED", "UNKNOWN"],
  acknowledgementState: ["NOT_REQUIRED", "NOT_ACKNOWLEDGED", "ACKNOWLEDGED", "REFUSED", "UNKNOWN"],
  dutyContext: ["ON_DUTY", "DRIVING", "ON_DUTY_NOT_DRIVING", "OFF_DUTY", "SLEEPER_BERTH", "PERSONAL_CONVEYANCE", "YARD_MOVE", "UNKNOWN"],
  hosProximity: ["NO_PROXIMITY_RECORDED", "APPROACHING_LIMIT", "LIMIT_EXCEEDED", "WITHIN_LIMIT", "UNKNOWN"],
  trafficCondition: ["LIGHT", "MODERATE", "HEAVY", "STOP_AND_GO", "UNKNOWN"],
  thresholdBasis: ["POSTED_SPEED_LIMIT", "COMPANY_THRESHOLD", "JURISDICTION_RULE", "PROVIDER_THRESHOLD", "OTHER"],
  oosScope: ["DRIVER", "VEHICLE", "BOTH", "OTHER"],
  yesNoUnknown: ["NO", "YES", "PENDING_DETERMINATION"],
  inspectionOutcome: [{ value: "CLEAN", label: "Clean" }, { value: "VIOLATIONS_FOUND", label: "Violations Found" }, { value: "OUT_OF_SERVICE", label: "Out of Service" }, { value: "OTHER_REVIEW_REQUIRED", label: "Other / Review Required" }],
};

const jurisdictionOptions: ControlledOption[] = JURISDICTIONS.map((item) => ({ value: item.code, label: item.label }));

const options = {
  collisionType: ["Rear-End", "Sideswipe", "Backing", "Intersection", "Lane Change", "Rollover", "Jackknife", "Fixed Object", "Animal", "Pedestrian", "Other"],
  weather: ["Clear", "Rain", "Snow", "Fog", "Ice / Freezing Rain", "High Wind", "Other", "Unknown"],
  road: ["Dry", "Wet", "Snow Covered", "Icy", "Gravel", "Construction", "Other", "Unknown"],
  lighting: ["Daylight", "Dawn / Dusk", "Dark â€” Lighted", "Dark â€” Unlighted", "Unknown"],
  result: ["Passed", "Violation(s) Found", "Out of Service"],
  source: ["Driver Report", "Company Staff", "Roadside Inspection", "ELD / Telematics", "Camera", "Customer", "Citation", "Maintenance", "Training", "Other"],
  zone: ["Urban", "Rural", "Highway", "Work Zone", "School Zone", "Rail Crossing", "Customer Site", "Other", "Unknown"],
  loadStatus: ["Loaded", "Empty", "Partial", "Unknown"],
  trigger: ["ELD / Telematics", "Forward Camera", "Driver Report", "Roadside Inspection", "Customer", "Other"],
  verification: ["Unverified", "Partially Verified", "Verified", "Unable to Verify"],
  dispute: ["Not Disputed", "Disputed", "Resolved"],
  dataIntegrity: ["DATA_ANOMALY", "DEVICE_MALFUNCTION", "SUSPECTED_INTERFERENCE", "SUSPECTED_TAMPERING", "CONFIRMED_TAMPERING", "DATA_LOSS", "DATA_RECOVERY"],
  operationalResult: ["On Time", "Late", "Early", "Cancelled", "Unable to Determine"],
  securityType: ["Theft", "Unauthorized Access", "Threat", "Fraud Indicator", "Security Breach", "Other"],
  cargoType: ["Damage", "Shortage", "Loss", "Contamination", "Securement Concern", "Other"],
  emergencyType: ["Fire", "Medical Emergency", "Weather Emergency", "Road Closure", "Vehicle Failure", "Security Emergency", "Other"],
  complaintCategory: ["Driving Conduct", "Communication", "Delivery Delay", "Cargo Handling", "Site / Shipper Conduct", "Documentation", "Other"],
  complaintState: ["Unreviewed", "Under Review", "Substantiated", "Not Substantiated", "Unable to Determine", "Closed"],
  citationDisposition: ["Pending", "Paid", "Contested", "Dismissed", "Guilty"],
  observationType: ["Safe Driving", "Procedure Compliance", "Customer Service", "Equipment Care", "Other"],
  violationType: ["Traffic", "Operational", "Safety", "Documentation", "Regulatory", "Other"],
  severityBand: ["Low", "Moderate", "High", "Critical"],
};

const machineValue = (label: string) => label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "UNKNOWN";
const humanizeMachineLabel = (value: string) => value.replace(/_/g, " ").replace(/\bUS LEVEL /, "US Level ").replace(/\bCA TYPE /, "CA Type ").replace(/\b\w/g, (c) => c.toUpperCase());
const toOptions = (values: readonly string[] | readonly ControlledOption[]) => values.map((item) => typeof item === "string" ? ({ value: machineValue(item), label: /^[A-Z0-9_]+$/.test(item) ? humanizeMachineLabel(item) : item }) : item);
const EXPLICIT_DATA_POINT_IDS: Readonly<Record<string, string>> = {
  'sourceType': 'DRV.PERF.SOURCETYPE',
  'sourceRecordId': 'DRV.PERF.SOURCERECORDID',
  'collisionType': 'DRV.PERF.COLLISIONTYPE',
  'otherPartyObject': 'DRV.PERF.OTHERPARTYOBJECT',
  'weather': 'DRV.PERF.SHARED.WEATHER_CONDITION',
  'roadCondition': 'DRV.PERF.SHARED.ROAD_SURFACE',
  'lightCondition': 'DRV.PERF.SHARED.LIGHTING_CONDITION',
  'speedAtOccurrence': 'DRV.PERF.SPEEDATOCCURRENCE',
  'injuriesCount': 'DRV.PERF.INJURIESCOUNT',
  'fatalitiesCount': 'DRV.PERF.FATALITIESCOUNT',
  'towRequired': 'DRV.PERF.TOWREQUIRED',
  'policeAttended': 'DRV.PERF.POLICEATTENDED',
  'policeReportNumber': 'DRV.PERF.POLICEREPORTNUMBER',
  'propertyDamage': 'DRV.PERF.PROPERTYDAMAGE',
  'reportabilityResult': 'DRV.PERF.REPORTABILITYRESULT',
  'downtimeHours': 'DRV.PERF.DOWNTIMEHOURS',
  'driverStatement': 'DRV.PERF.DRIVERSTATEMENT',
  'investigationNotes': 'DRV.PERF.INVESTIGATIONNOTES',
  'nearMissType': 'DRV.PERF.NEARMISSTYPE',
  'triggerSource': 'DRV.PERF.TRIGGERSOURCE',
  'distanceToImpact': 'DRV.PERF.DISTANCETOIMPACT',
  'timeToCollision': 'DRV.PERF.TIMETOCOLLISION',
  'speed': 'DRV.PERF.SPEED',
  'avoidanceAction': 'DRV.PERF.AVOIDANCEACTION',
  'zoneType': 'DRV.PERF.SHARED.ZONE_TYPE',
  'contextNotes': 'DRV.PERF.CONTEXTNOTES',
  'jurisdiction': 'DRV.PERF.JURISDICTION',
  'inspectionRegime': 'DRV.PERF.INSPECTIONREGIME',
  'inspectionClassification': 'DRV.PERF.INSPECTIONCLASSIFICATION',
  'agency': 'DRV.PERF.AGENCY',
  'inspectionReportNumber': 'DRV.PERF.INSPECTIONREPORTNUMBER',
  'inspectionResult': 'DRV.PERF.INSPECTIONRESULT',
  'driverViolationsCount': 'DRV.PERF.DRIVERVIOLATIONSCOUNT',
  'vehicleViolationsCount': 'DRV.PERF.VEHICLEVIOLATIONSCOUNT',
  'hosViolationsCount': 'DRV.PERF.HOSVIOLATIONSCOUNT',
  'driverOOS': 'DRV.PERF.DRIVEROOS',
  'vehicleOOS': 'DRV.PERF.VEHICLEOOS',
  'hazmatInspected': 'DRV.PERF.HAZMATINSPECTED',
  'oosType': 'DRV.PERF.OOSTYPE',
  'oosScope': 'DRV.PERF.OOSSCOPE',
  'relatedHOS': 'DRV.PERF.RELATEDHOS',
  'citationIssued': 'DRV.PERF.CITATIONISSUED',
  'maintenanceRequired': 'DRV.PERF.MAINTENANCEREQUIRED',
  'trainingRequired': 'DRV.PERF.TRAININGREQUIRED',
  'otherScopeExplanation': 'DRV.PERF.OOSSCOPEEXPLANATION',
  'oosReleaseDate': 'DRV.PERF.OOSRELEASEDATE',
  'linkedRepairRecordId': 'DRV.PERF.LINKEDREPAIRRECORDID',
  'orderNumber': 'DRV.PERF.ORDERNUMBER',
  'issuingAgency': 'DRV.PERF.ISSUINGAGENCY',
  'issuedDate': 'DRV.PERF.ISSUEDDATE',
  'releaseDate': 'DRV.PERF.RELEASEDATE',
  'releaseAuthority': 'DRV.PERF.RELEASEAUTHORITY',
  'basis': 'DRV.PERF.BASIS',
  'ruleJurisdiction': 'DRV.PERF.RULEJURISDICTION',
  'ruleProfileId': 'DRV.PERF.RULEPROFILEID',
  'violationType': 'DRV.PERF.VIOLATIONTYPE',
  'logDate': 'DRV.PERF.LOGDATE',
  'detectionSource': 'DRV.PERF.DETECTIONSOURCE',
  'hoursExceeded': 'DRV.PERF.HOURSEXCEEDED',
  'eldProvider': 'DRV.PERF.ELDPROVIDER',
  'reviewStatus': 'DRV.PERF.REVIEWSTATUS',
  'reviewNotes': 'DRV.PERF.REVIEWNOTES',
  'citationNumber': 'DRV.PERF.CITATIONNUMBER',
  'violationCode': 'DRV.PERF.VIOLATIONCODE',
  'fineAmount': 'DRV.PERF.FINEAMOUNT',
  'pointsAssessed': 'DRV.PERF.POINTSASSESSED',
  'courtJurisdiction': 'DRV.PERF.COURTJURISDICTION',
  'courtDate': 'DRV.PERF.COURTDATE',
  'disposition': 'DRV.PERF.DISPOSITION',
  'cargoIssueType': 'DRV.PERF.CARGOISSUETYPE',
  'cargoReference': 'DRV.PERF.CARGOREFERENCE',
  'cargoDescription': 'DRV.PERF.CARGODESCRIPTION',
  'quantityAffected': 'DRV.PERF.QUANTITYAFFECTED',
  'estimatedLossAmount': 'DRV.PERF.ESTIMATEDLOSSAMOUNT',
  'packagingFailure': 'DRV.PERF.PACKAGINGFAILURE',
  'securementConcern': 'DRV.PERF.SECUREMENTCONCERN',
  'damageNotes': 'DRV.PERF.DAMAGENOTES',
  'lastKnownLocation': 'DRV.PERF.LASTKNOWNLOCATION',
  'lastKnownDate': 'DRV.PERF.LASTKNOWNDATE',
  'securityReference': 'DRV.PERF.SECURITYREFERENCE',
  'sealCompromised': 'DRV.PERF.SEALCOMPROMISED',
  'theftNarrative': 'DRV.PERF.THEFTNARRATIVE',
  'material': 'DRV.PERF.MATERIAL',
  'quantityReleased': 'DRV.PERF.QUANTITYRELEASED',
  'quantityUnit': 'DRV.PERF.QUANTITYUNIT',
  'releaseEnvironment': 'DRV.PERF.RELEASEENVIRONMENT',
  'containmentPerformed': 'DRV.PERF.CONTAINMENTPERFORMED',
  'emergencyResponse': 'DRV.PERF.EMERGENCYRESPONSE',
  'reportReference': 'DRV.PERF.REPORTREFERENCE',
  'responseNotes': 'DRV.PERF.RESPONSENOTES',
  'customerName': 'DRV.PERF.CUSTOMERNAME',
  'customerReference': 'DRV.PERF.CUSTOMERREFERENCE',
  'loadNumber': 'DRV.PERF.LOADNUMBER',
  'complaintCategory': 'DRV.PERF.COMPLAINTCATEGORY',
  'receivedDate': 'DRV.PERF.RECEIVEDDATE',
  'complaintNarrative': 'DRV.PERF.COMPLAINTNARRATIVE',
  'substantiationStatus': 'DRV.PERF.SUBSTANTIATIONSTATUS',
  'commendationType': 'DRV.PERF.COMMENDATIONTYPE',
  'recognizedBy': 'DRV.PERF.RECOGNIZEDBY',
  'recognitionDate': 'DRV.PERF.RECOGNITIONDATE',
  'recognitionNarrative': 'DRV.PERF.RECOGNITIONNARRATIVE',
  'observationType': 'DRV.PERF.OBSERVATIONTYPE',
  'observer': 'DRV.PERF.OBSERVER',
  'observationDate': 'DRV.PERF.OBSERVATIONDATE',
  'observationNarrative': 'DRV.PERF.OBSERVATIONNARRATIVE',
  'topic': 'DRV.PERF.TOPIC',
  'coachReference': 'DRV.PERF.COACHREFERENCE',
  'sessionDate': 'DRV.PERF.SESSIONDATE',
  'discussionSummary': 'DRV.PERF.DISCUSSIONSUMMARY',
  'observedFacts': 'DRV.PERF.OBSERVEDFACTS',
  'companyActionReference': 'DRV.PERF.COMPANYACTIONREFERENCE',
  'actionType': 'DRV.PERF.ACTIONTYPE',
  'effectiveDate': 'DRV.PERF.EFFECTIVEDATE',
  'factualBasis': 'DRV.PERF.FACTUALBASIS',
  'planId': 'DRV.PERF.PLANID',
  'targetDate': 'DRV.PERF.TARGETDATE',
  'planState': 'DRV.PERF.PLANSTATE',
  'planContext': 'DRV.PERF.PLANCONTEXT',
  'injuryContext': 'DRV.PERF.INJURYCONTEXT',
  'injuryReference': 'DRV.PERF.INJURYREFERENCE',
  'injuryDate': 'DRV.PERF.INJURYDATE',
  'dutyImpact': 'DRV.PERF.DUTYIMPACT',
  'fitnessState': 'DRV.PERF.FITNESSSTATE',
  'operationalNotes': 'DRV.PERF.OPERATIONALNOTES',
  'securityType': 'DRV.PERF.SECURITYTYPE',
  'incidentReference': 'DRV.PERF.INCIDENTREFERENCE',
  'affectedAsset': 'DRV.PERF.AFFECTEDASSET',
  'lawEnforcementNotified': 'DRV.PERF.LAWENFORCEMENTNOTIFIED',
  'incidentNarrative': 'DRV.PERF.INCIDENTNARRATIVE',
  'warningReference': 'DRV.PERF.WARNINGREFERENCE',
  'issuingAuthority': 'DRV.PERF.ISSUINGAUTHORITY',
  'warningType': 'DRV.PERF.WARNINGTYPE',
  'regulatorySource': 'DRV.PERF.REGULATORYSOURCE',
  'violationDescription': 'DRV.PERF.VIOLATIONDESCRIPTION',
  'citationId': 'DRV.PERF.CITATIONID',
  'linkedEventContext': 'DRV.PERF.LINKEDEVENTCONTEXT',
  'notes': 'DRV.PERF.NOTES',
  'equipmentIssueType': 'DRV.PERF.EQUIPMENTISSUETYPE',
  'maintenanceReference': 'DRV.PERF.MAINTENANCEREFERENCE',
  'vehicleContext': 'DRV.PERF.VEHICLECONTEXT',
  'defectReported': 'DRV.PERF.DEFECTREPORTED',
  'reportedDate': 'DRV.PERF.REPORTEDDATE',
  'equipmentNarrative': 'DRV.PERF.EQUIPMENTNARRATIVE',
  'observationState': 'DRV.PERF.OBSERVATIONSTATE',
  'complimentDate': 'DRV.PERF.COMPLIMENTDATE',
  'complimentNarrative': 'DRV.PERF.COMPLIMENTNARRATIVE',
  'provider': 'DRV.PERF.PROVIDER',
  'providerEventId': 'DRV.PERF.PROVIDEREVENTID',
  'rawValue': 'DRV.PERF.RAWVALUE',
  'rawUnit': 'DRV.PERF.RAWUNIT',
  'thresholdValue': 'DRV.PERF.THRESHOLDVALUE',
  'thresholdUnit': 'DRV.PERF.THRESHOLDUNIT',
  'thresholdSource': 'DRV.PERF.THRESHOLDSOURCE',
  'thresholdId': 'DRV.PERF.THRESHOLDID',
  'thresholdVersion': 'DRV.PERF.THRESHOLDVERSION',
  'thresholdEffectiveDate': 'DRV.PERF.THRESHOLDEFFECTIVEDATE',
  'variance': 'DRV.PERF.VARIANCE',
  'durationSeconds': 'DRV.PERF.DURATIONSECONDS',
  'peakValue': 'DRV.PERF.PEAKVALUE',
  'averageValue': 'DRV.PERF.AVERAGEVALUE',
  'assetReference': 'DRV.PERF.ASSETREFERENCE',
  'accessCompromised': 'DRV.PERF.ACCESSCOMPROMISED',
  'eventNarrative': 'DRV.PERF.EVENTNARRATIVE',
  'emergencyType': 'DRV.PERF.EMERGENCYTYPE',
  'responseReference': 'DRV.PERF.RESPONSEREFERENCE',
  'emergencyServices': 'DRV.PERF.EMERGENCYSERVICES',
  'emergencyNarrative': 'DRV.PERF.EMERGENCYNARRATIVE',
  'thresholdBasis': 'DRV.PERF.THRESHOLDBASIS',
  'actualSpeed': 'DRV.PERF.ACTUALSPEED',
  'speedUnit': 'DRV.PERF.SPEEDUNIT',
  'postedSpeedLimit': 'DRV.PERF.POSTEDSPEEDLIMIT',
  'companyThreshold': 'DRV.PERF.COMPANYTHRESHOLD',
  'applicableThreshold': 'DRV.PERF.APPLICABLETHRESHOLD',
  'amountExceeded': 'DRV.PERF.AMOUNTEXCEEDED',
  'distanceTraveled': 'DRV.PERF.DISTANCETRAVELED',
  'peakSpeed': 'DRV.PERF.PEAKSPEED',
  'averageSpeed': 'DRV.PERF.AVERAGESPEED',
  'loadStatus': 'DRV.PERF.SHARED.LOAD_STATE',
  'triggerDeceleration': 'DRV.PERF.TRIGGERDECELERATION',
  'threshold': 'DRV.PERF.THRESHOLD',
  'thresholdVariance': 'DRV.PERF.THRESHOLDVARIANCE',
  'peakDeceleration': 'DRV.PERF.PEAKDECELERATION',
  'averageDeceleration': 'DRV.PERF.AVERAGEDECELERATION',
  'speedAtTrigger': 'DRV.PERF.SPEEDATTRIGGER',
  'endingSpeed': 'DRV.PERF.ENDINGSPEED',
  'distanceMeters': 'DRV.PERF.DISTANCEMETERS',
  'roadGrade': 'DRV.PERF.ROADGRADE',
  'roadSurface': 'DRV.PERF.SHARED.ROAD_SURFACE',
  'lighting': 'DRV.PERF.SHARED.LIGHTING_CONDITION',
  'traffic': 'DRV.PERF.SHARED.TRAFFIC_CONDITION',
  'forwardCollisionWarning': 'DRV.PERF.FORWARDCOLLISIONWARNING',
  'triggerAcceleration': 'DRV.PERF.TRIGGERACCELERATION',
  'peakAcceleration': 'DRV.PERF.PEAKACCELERATION',
  'averageAcceleration': 'DRV.PERF.AVERAGEACCELERATION',
  'triggerSpeed': 'DRV.PERF.TRIGGERSPEED',
  'road': 'DRV.PERF.SHARED.ROAD_SURFACE',
  'lateralAcceleration': 'DRV.PERF.LATERALACCELERATION',
  'peakLateralAcceleration': 'DRV.PERF.PEAKLATERALACCELERATION',
  'averageLateralAcceleration': 'DRV.PERF.AVERAGELATERALACCELERATION',
  'turnRadius': 'DRV.PERF.TURNRADIUS',
  'roadGeometry': 'DRV.PERF.ROADGEOMETRY',
  'timeGapSeconds': 'DRV.PERF.TIMEGAPSECONDS',
  'timeGapThresholdSeconds': 'DRV.PERF.TIMEGAPTHRESHOLDSECONDS',
  'timeGapVarianceSeconds': 'DRV.PERF.TIMEGAPVARIANCESECONDS',
  'distanceGapMeters': 'DRV.PERF.DISTANCEGAPMETERS',
  'distanceThresholdMeters': 'DRV.PERF.DISTANCETHRESHOLDMETERS',
  'distanceVarianceMeters': 'DRV.PERF.DISTANCEVARIANCEMETERS',
  'minimumTimeGapSeconds': 'DRV.PERF.MINIMUMTIMEGAPSECONDS',
  'minimumDistanceGapMeters': 'DRV.PERF.MINIMUMDISTANCEGAPMETERS',
  'driverVehicleSpeed': 'DRV.PERF.DRIVERVEHICLESPEED',
  'leadVehicleSpeed': 'DRV.PERF.LEADVEHICLESPEED',
  'relativeSpeed': 'DRV.PERF.RELATIVESPEED',
  'distanceTraveledMeters': 'DRV.PERF.DISTANCETRAVELEDMETERS',
  'indicatorType': 'DRV.PERF.INDICATORTYPE',
  'eyeClosureDurationMs': 'DRV.PERF.EYECLOSUREDURATIONMS',
  'perclosPercent': 'DRV.PERF.PERCLOSPERCENT',
  'hoursDriven': 'DRV.PERF.HOURSDRIVEN',
  'timeSinceBreakMinutes': 'DRV.PERF.TIMESINCEBREAKMINUTES',
  'consecutiveDrivingDays': 'DRV.PERF.CONSECUTIVEDRIVINGDAYS',
  'dutyContext': 'DRV.PERF.SHARED.DUTY_CONTEXT',
  'hosProximity': 'DRV.PERF.HOSPROXIMITY',
  'sourceClassification': 'DRV.PERF.SOURCECLASSIFICATION',
  'indicatorNotes': 'DRV.PERF.INDICATORNOTES',
  'integrityState': 'DRV.PERF.INTEGRITYSTATE',
  'deviceType': 'DRV.PERF.DEVICETYPE',
  'anomalyType': 'DRV.PERF.ANOMALYTYPE',
  'interferenceMethod': 'DRV.PERF.INTERFERENCEMETHOD',
  'dataImpact': 'DRV.PERF.DATAIMPACT',
  'detectionDate': 'DRV.PERF.DETECTIONDATE',
  'detectionTime': 'DRV.PERF.DETECTIONTIME',
  'deviceDisabled': 'DRV.PERF.DEVICEDISABLED',
  'dataLossDurationMinutes': 'DRV.PERF.DATALOSSDURATIONMINUTES',
  'dataRecoveryState': 'DRV.PERF.DATARECOVERYSTATE',
  'serviceRepairReference': 'DRV.PERF.SERVICEREPAIRREFERENCE',
  'tripReference': 'DRV.PERF.TRIPREFERENCE',
  'loadReference': 'DRV.PERF.LOADREFERENCE',
  'serviceType': 'DRV.PERF.SERVICETYPE',
  'scheduledDate': 'DRV.PERF.SCHEDULEDDATE',
  'scheduledTime': 'DRV.PERF.SCHEDULEDTIME',
  'actualDate': 'DRV.PERF.ACTUALDATE',
  'actualTime': 'DRV.PERF.ACTUALTIME',
  'calculatedVarianceMinutes': 'DRV.PERF.CALCULATEDVARIANCEMINUTES',
  'serviceMetric': 'DRV.PERF.SERVICEMETRIC',
  'metricValue': 'DRV.PERF.METRICVALUE',
  'metricThreshold': 'DRV.PERF.METRICTHRESHOLD',
  'notificationState': 'DRV.PERF.NOTIFICATIONSTATE',
  'acknowledgementState': 'DRV.PERF.ACKNOWLEDGEMENTSTATE',
  'customerSiteReference': 'DRV.PERF.CUSTOMERSITEREFERENCE',
  'podReference': 'DRV.PERF.PODREFERENCE',
  'customerNotificationSent': 'DRV.PERF.CUSTOMERNOTIFICATIONSENT',
  'lateralDeviationMeters': 'DRV.PERF.LATERALDEVIATIONMETERS',
  'laneType': 'DRV.PERF.LANETYPE',
  'roadType': 'DRV.PERF.ROADTYPE',
  'seatbeltState': 'DRV.PERF.SEATBELTSTATE',
  'distractionType': 'DRV.PERF.DISTRACTIONTYPE',
  'sourceEventId': 'DRV.PERF.SOURCEEVENTID',
  'observedContext': 'DRV.PERF.OBSERVEDCONTEXT',
  'durationMinutes': 'DRV.PERF.DURATIONMINUTES',
  'thresholdMinutes': 'DRV.PERF.THRESHOLDMINUTES',
  'varianceMinutes': 'DRV.PERF.VARIANCEMINUTES',
  'locationType': 'DRV.PERF.LOCATIONTYPE',
  'plannedRouteReference': 'DRV.PERF.PLANNEDROUTEREFERENCE',
  'actualRouteReference': 'DRV.PERF.ACTUALROUTEREFERENCE',
  'deviationDistanceMiles': 'DRV.PERF.DEVIATIONDISTANCEMILES',
  'deviationDurationMinutes': 'DRV.PERF.DEVIATIONDURATIONMINUTES',
  'deviationReason': 'DRV.PERF.DEVIATIONREASON',
  'maneuverType': 'DRV.PERF.MANEUVERTYPE',
  'spotterUsed': 'DRV.PERF.SPOTTERUSED',
  'contactOccurred': 'DRV.PERF.CONTACTOCCURRED',
  'objectContacted': 'DRV.PERF.OBJECTCONTACTED',
  'siteType': 'DRV.PERF.SITETYPE',
  'controlType': 'DRV.PERF.CONTROLTYPE',
  'observedOutcome': 'DRV.PERF.OBSERVEDOUTCOME',
  'speedAtControl': 'DRV.PERF.SPEEDATCONTROL',
  'citationReference': 'DRV.PERF.CITATIONREFERENCE',
  'crossingType': 'DRV.PERF.CROSSINGTYPE',
  'observedAction': 'DRV.PERF.OBSERVEDACTION',
  'trainPresent': 'DRV.PERF.TRAINPRESENT',
  'gatesDown': 'DRV.PERF.GATESDOWN',
  'crossingReference': 'DRV.PERF.CROSSINGREFERENCE',
  'behaviorType': 'DRV.PERF.BEHAVIORTYPE',
  'behaviorNarrative': 'DRV.PERF.BEHAVIORNARRATIVE',
  'protocolType': 'DRV.PERF.PROTOCOLTYPE',
  'observedState': 'DRV.PERF.OBSERVEDSTATE',
  'requirementSource': 'DRV.PERF.REQUIREMENTSOURCE',
  'siteReference': 'DRV.PERF.SITEREFERENCE',
};
const explicitDataPointId = (key: string) => {
  const id = EXPLICIT_DATA_POINT_IDS[key];
  if (!id) throw new Error(`Missing explicit Data Point ID for schema field: ${key}`);
  return id;
};
const f = (key: string, label: string, kind: PerformanceFieldKind, extra: Partial<PerformanceFieldDefinition> = {}): PerformanceFieldDefinition => ({ key, label, kind, dataPointId: extra.dataPointId || explicitDataPointId(key), valueType: extra.valueType || (kind === "number" ? "number" : kind === "boolean" ? "boolean" : kind === "date" ? "date" : kind === "time" ? "time" : kind === "select" ? "string" : "string"), ...extra });
const text = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "text", extra);
const select = (key: string, label: string, values: readonly string[] | readonly ControlledOption[], extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "select", { ...extra, options: toOptions(values) });
const number = (key: string, label: string, unit?: string, extra: Partial<PerformanceFieldDefinition> = {}) => {
  const unitOptions = unit === "mph / km/h" || unit === "speed unit" ? ["MPH", "KMH"] : unit === "miles / km" ? ["MI", "KM"] : unit === "m/sÂ²" ? ["MPS2", "FTPS2", "G"] : undefined;
  const canonicalUnit = unitOptions ? undefined : unit;
  return f(key, label, "number", { ...extra, unit: canonicalUnit, unitOptions, unitInput: extra.unitInput || unit === "dynamic", valueType: canonicalUnit && ["seconds","minutes","hours"].includes(canonicalUnit) ? "duration" : "measurement" });
};
const bool = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "boolean", extra);
const date = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "date", extra);
const time = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "time", extra);
const area = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "textarea", extra);

const base: PerformanceFieldDefinition[] = [
  select("sourceType", "Source", options.source, { required: true }),
  text("sourceRecordId", "Source Record ID", { helpText: "Use the authoritative source identifier when one exists." }),
];

const DOCUMENT_POLICY: PerformancePolicyDefinition = { evidenceRequired: true, verification: "DERIVED", lifecycle: "DERIVED", followUp: "EXPLICIT", ingestion: "DOCUMENT_FIRST_CAPABLE" };
const MANUAL_POLICY: PerformancePolicyDefinition = { evidenceRequired: false, verification: "DERIVED", lifecycle: "DERIVED", followUp: "EXPLICIT", ingestion: "MANUAL_FALLBACK" };
const SYSTEM_POLICY: PerformancePolicyDefinition = { evidenceRequired: false, verification: "DERIVED", lifecycle: "NOT_APPLICABLE", followUp: "EXPLICIT", ingestion: "SYSTEM_SOURCE" };

const SOURCE_ORIGINS: readonly ControlledOption[] = [
  { value: "DOCUMENT_OCR", label: "Document / OCR" },
  { value: "MANUAL_ENTRY", label: "Manual Entry" },
  { value: "API_INTEGRATION", label: "API Integration" },
  { value: "SYSTEM_DERIVED", label: "System Derived" },
  { value: "TELEMATICS_INGESTION", label: "Telematics Ingestion" },
  { value: "ELD_INGESTION", label: "ELD Ingestion" },
];

const REPORTER_OPTIONS: readonly ControlledOption[] = [
  { value: "DRIVER", label: "Driver" },
  { value: "COMPANY_USER", label: "Company User" },
  { value: "TES_REVIEWER", label: "TES Reviewer" },
  { value: "INTEGRATION", label: "Integration" },
  { value: "OTHER", label: "Other" },
];

const SOURCE_OPTIONS: Readonly<Record<string, readonly ControlledOption[]>> = {
  REGULATORY_DOCUMENT: [
    { value: "Roadside Inspection", label: "Roadside Inspection" },
    { value: "Citation", label: "Citation" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Other", label: "Other" },
  ],
  ROADSIDE_INSPECTION: [
    { value: "Roadside Inspection", label: "Roadside Inspection" },
  ],
  OOS: [
    { value: "Roadside Inspection", label: "Roadside Inspection" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Other", label: "Other" },
  ],
  COLLISION_INCIDENT: [
    { value: "Driver Report", label: "Driver Report" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Camera", label: "Camera" },
    { value: "Roadside Inspection", label: "Roadside Inspection" },
    { value: "Other", label: "Other" },
  ],
  CUSTOMER: [
    { value: "Customer", label: "Customer" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Other", label: "Other" },
  ],
  CARGO: [
    { value: "Driver Report", label: "Driver Report" },
    { value: "Customer", label: "Customer" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Camera", label: "Camera" },
    { value: "Other", label: "Other" },
  ],
  SECURITY: [
    { value: "Driver Report", label: "Driver Report" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Camera", label: "Camera" },
    { value: "Customer", label: "Customer" },
    { value: "Other", label: "Other" },
  ],
  EQUIPMENT_MAINTENANCE: [
    { value: "Maintenance", label: "Maintenance" },
    { value: "Driver Report", label: "Driver Report" },
    { value: "Camera", label: "Camera" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Other", label: "Other" },
  ],
  SERVICE_TRIP: [
    { value: "Company Staff", label: "Company Staff" },
    { value: "Customer", label: "Customer" },
    { value: "Driver Report", label: "Driver Report" },
    { value: "Other", label: "Other" },
  ],
  OBSERVATION: [
    { value: "Company Staff", label: "Company Staff" },
    { value: "Camera", label: "Camera" },
    { value: "Driver Report", label: "Driver Report" },
    { value: "Customer", label: "Customer" },
    { value: "Other", label: "Other" },
  ],
  EMERGENCY: [
    { value: "Driver Report", label: "Driver Report" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Camera", label: "Camera" },
    { value: "Other", label: "Other" },
  ],
  TELEMATICS: [
    { value: "ELD / Telematics", label: "ELD / Telematics" },
    { value: "Camera", label: "Camera" },
    { value: "Company Staff", label: "Company Staff" },
    { value: "Driver Report", label: "Driver Report" },
    { value: "Other", label: "Other" },
  ],
};

const makeSourcePolicy = (family: keyof typeof SOURCE_OPTIONS, allowedOrigins: readonly string[], defaultOrigin = "MANUAL_ENTRY", deriveAuthoritativeSource?: string): PerformanceSourcePolicy => ({
  allowedOrigins,
  defaultOrigin,
  authoritativeSourceTypes: SOURCE_OPTIONS[family],
  reporterApplicability: REPORTER_OPTIONS,
  deriveAuthoritativeSource,
});

const ORIGINS_DOCUMENT_MANUAL_API = ["DOCUMENT_OCR", "MANUAL_ENTRY", "API_INTEGRATION"] as const;
const ORIGINS_DOCUMENT_MANUAL_API_SYSTEM = ["DOCUMENT_OCR", "MANUAL_ENTRY", "API_INTEGRATION", "SYSTEM_DERIVED"] as const;
const ORIGINS_TELEMATICS = ["TELEMATICS_INGESTION", "ELD_INGESTION", "API_INTEGRATION", "DOCUMENT_OCR", "MANUAL_ENTRY"] as const;

const SOURCE_POLICY_FAMILIES = {
  REGULATORY_DOCUMENT: makeSourcePolicy("REGULATORY_DOCUMENT", ORIGINS_DOCUMENT_MANUAL_API),
  ROADSIDE_INSPECTION: makeSourcePolicy("ROADSIDE_INSPECTION", ["DOCUMENT_OCR", "MANUAL_ENTRY", "API_INTEGRATION"], "DOCUMENT_OCR", "Roadside Inspection"),
  OOS: makeSourcePolicy("OOS", ORIGINS_DOCUMENT_MANUAL_API),
  COLLISION_INCIDENT: makeSourcePolicy("COLLISION_INCIDENT", ORIGINS_DOCUMENT_MANUAL_API),
  CUSTOMER: makeSourcePolicy("CUSTOMER", ORIGINS_DOCUMENT_MANUAL_API),
  SECURITY: makeSourcePolicy("SECURITY", ORIGINS_DOCUMENT_MANUAL_API),
  EQUIPMENT_MAINTENANCE: makeSourcePolicy("EQUIPMENT_MAINTENANCE", ORIGINS_DOCUMENT_MANUAL_API),
  SERVICE_TRIP: makeSourcePolicy("SERVICE_TRIP", ORIGINS_DOCUMENT_MANUAL_API_SYSTEM),
  OBSERVATION: makeSourcePolicy("OBSERVATION", ORIGINS_DOCUMENT_MANUAL_API),
  EMERGENCY: makeSourcePolicy("EMERGENCY", ORIGINS_DOCUMENT_MANUAL_API),
  TELEMATICS: makeSourcePolicy("TELEMATICS", ORIGINS_TELEMATICS),
} as const;

const oosRelationships: PerformanceRelationshipDefinition[] = [
  { key: "vehicle", entityType: "Vehicle", label: "Related Vehicle", applicability: [{ state: "CONDITIONAL", when: { oosScope: ["VEHICLE", "BOTH"] } }], canonical: true },
  { key: "hos", entityType: "HOS", label: "Related HOS Record", applicability: [{ state: "CONDITIONAL", when: { relatedHOS: ["YES"] } }], operationalReferenceType: "HOS_REFERENCE" },
  { key: "citation", entityType: "Citation", label: "Related Citation", applicability: [{ state: "CONDITIONAL", when: { citationIssued: ["YES"] } }], operationalReferenceType: "CITATION_REFERENCE" },
  { key: "maintenance", entityType: "Maintenance", label: "Related Maintenance Record", applicability: [{ state: "CONDITIONAL", when: { maintenanceRequired: ["YES"], oosScope: ["VEHICLE", "BOTH"] } }], canonical: true, operationalReferenceType: "MAINTENANCE_REFERENCE" },
  { key: "training", entityType: "Training", label: "Related Training Record", applicability: [{ state: "CONDITIONAL", when: { trainingRequired: ["YES"] } }], canonical: true },
];

const OPTIONAL_VEHICLE_RELATIONSHIP: PerformanceRelationshipDefinition = { key: "vehicle", entityType: "Vehicle", label: "Related Vehicle", applicability: [{ state: "OPTIONAL" }], canonical: true };
const REPRESENTATIVE_RELATIONSHIPS: Readonly<Partial<Record<EventType, readonly PerformanceRelationshipDefinition[]>>> = {
  "Collision": [OPTIONAL_VEHICLE_RELATIONSHIP],
  "Near Miss": [OPTIONAL_VEHICLE_RELATIONSHIP],
  "Roadside Inspection": [OPTIONAL_VEHICLE_RELATIONSHIP],
  "Speeding": [OPTIONAL_VEHICLE_RELATIONSHIP],
  "Harsh Braking": [OPTIONAL_VEHICLE_RELATIONSHIP],
  "Device / Data Integrity": [OPTIONAL_VEHICLE_RELATIONSHIP],
};

const defaultSteps: readonly PerformanceStepDefinition[] = [
  { key: "CATEGORY", label: "Category" },
  { key: "OCCURRENCE", label: "Occurrence & Provenance" },
  { key: "FACTS", label: "Category Facts" },
  {
    key: "RELATIONSHIPS",
    label: "Relationships",
    applicability: [{ state: "CONDITIONAL" }],
  },
  { key: "EVIDENCE", label: "Evidence & Follow-up" },
  { key: "REVIEW", label: "Review" },
];

export function resolvePerformanceApplicability(ruleSet: readonly PerformanceApplicabilityRule[] | undefined, facts: Record<string, unknown>): PerformanceApplicabilityState {
  if (!ruleSet || ruleSet.length === 0) return "OPTIONAL";
  for (const rule of ruleSet) {
    if (!rule.when) return rule.state;
    const matches = Object.entries(rule.when).every(([key, values]) => values.includes(String(facts[key] ?? "")));
    if (matches) return rule.state;
  }
  return "NOT_APPLICABLE";
}

export function resolveRelationshipApplicability(definition: PerformanceCategoryDefinition, facts: Record<string, unknown>): PerformanceRelationshipDefinition[] {
  return (definition.relationships || []).filter((relationship) => resolvePerformanceRelationshipState(relationship, facts) !== "HIDDEN" && resolvePerformanceRelationshipState(relationship, facts) !== "NOT_APPLICABLE");
}

export function resolvePerformanceRelationshipState(relationship: PerformanceRelationshipDefinition, facts: Record<string, unknown>): PerformanceApplicabilityState {
  return resolvePerformanceApplicability(relationship.applicability, facts);
}

export function resolvePerformanceSteps(
  definition: PerformanceCategoryDefinition,
  facts: Record<string, unknown>,
): PerformanceStepDefinition[] {
  const steps = definition.policy?.steps || defaultSteps;

  const relationshipsApplicable =
    resolveRelationshipApplicability(definition, facts).length > 0;

  return steps.filter((step) => {
    if (step.key === "RELATIONSHIPS") {
      return relationshipsApplicable;
    }

    const state = resolvePerformanceApplicability(
      step.applicability,
      facts,
    );

    return state !== "HIDDEN" && state !== "NOT_APPLICABLE";
  });
}

export type PerformanceCategoryOwnership = "RECORDABLE_EVENT" | "LEGACY_READ_ONLY" | "COMPANY_ACTION" | "AUTHORITATIVE_LINKED_RECORD" | "SPECIALIZED_WORKSPACE_RECORD" | "ALIAS";

export const PERFORMANCE_EVENT_SCHEMA_VERSION = "1.2";

export const PERFORMANCE_CATEGORY_OWNERSHIP: Readonly<Record<EventType, PerformanceCategoryOwnership>> = {
  "Collision": "RECORDABLE_EVENT", "Near Miss": "RECORDABLE_EVENT", "Roadside Inspection": "RECORDABLE_EVENT", "Out-of-Service Order": "RECORDABLE_EVENT",
  "HOS Violation": "AUTHORITATIVE_LINKED_RECORD", "Traffic Citation": "AUTHORITATIVE_LINKED_RECORD", "Cargo Damage": "RECORDABLE_EVENT", "Cargo Theft": "RECORDABLE_EVENT",
  "Spill or Release": "RECORDABLE_EVENT", "Customer Complaint": "RECORDABLE_EVENT", "Customer Commendation": "RECORDABLE_EVENT", "Positive Safety Observation": "ALIAS",
  "Coaching Session": "COMPANY_ACTION", "Disciplinary Action": "COMPANY_ACTION", "Corrective Action Plan": "COMPANY_ACTION", "Injury": "RECORDABLE_EVENT",
  "Security Incident": "RECORDABLE_EVENT", "Warning": "RECORDABLE_EVENT", "Violation": "RECORDABLE_EVENT", "Citation-linked Event": "LEGACY_READ_ONLY",
  "Equipment-related Event": "ALIAS", "Equipment Failure / Critical Defect": "RECORDABLE_EVENT", "Safety Observation": "RECORDABLE_EVENT", "Customer Compliment": "ALIAS", "Telematics / Camera Observation": "SPECIALIZED_WORKSPACE_RECORD",
  "Security Event": "ALIAS", "Emergency Event": "RECORDABLE_EVENT", "Speeding": "RECORDABLE_EVENT", "Harsh Braking": "RECORDABLE_EVENT", "Harsh Acceleration": "RECORDABLE_EVENT",
  "Harsh Cornering": "RECORDABLE_EVENT", "Following Distance": "RECORDABLE_EVENT", "Fatigue Indicator": "RECORDABLE_EVENT", "Device / Data Integrity": "RECORDABLE_EVENT",
  "Trip Completion / Service Performance": "RECORDABLE_EVENT", "Lane Departure": "RECORDABLE_EVENT", "Seatbelt": "RECORDABLE_EVENT", "Distracted Driving": "RECORDABLE_EVENT",
  "Idle Time": "RECORDABLE_EVENT", "Route Deviation": "RECORDABLE_EVENT", "Backing": "RECORDABLE_EVENT", "Stop Sign / Red Light": "RECORDABLE_EVENT", "Railroad Crossing": "RECORDABLE_EVENT",
  "Customer-Site Behavior": "RECORDABLE_EVENT", "PPE / Safety Protocol": "RECORDABLE_EVENT"
};



const DRIVER_PERFORMANCE_CATEGORY_REGISTRY_RAW: readonly PerformanceCategoryDefinition[] = [
  {
    code: "COLLISION", value: "Collision", label: "Collision", description: "A vehicle collision or physical contact occurrence requiring factual, consequence, and evidence capture.", group: "Safety", sources: options.source, evidenceRequired: true, determinationTypes: ["COLLISION_PREVENTABILITY", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("collisionType", "Collision Configuration", options.collisionType, { required: true }), text("otherPartyObject", "Other Party / Object"), select("weather", "Weather", options.weather), select("roadCondition", "Road Surface", options.road), select("lightCondition", "Lighting", options.lighting), number("speedAtOccurrence", "Speed at Occurrence", "mph / km/h"), number("injuriesCount", "Injuries", "count"), number("fatalitiesCount", "Fatalities", "count"), bool("towRequired", "Tow-Away"), bool("policeAttended", "Police Attended"), bool("propertyDamage", "Property Damage"), select("reportabilityResult", "Reportability Result", ["Reportable", "Not Reportable", "Unable to Determine"], { helpText: "Preserve the governing jurisdiction/rule context in the reportability determination fields." }), number("downtimeHours", "Downtime", "hours"), area("driverStatement", "Driver Statement"), area("investigationNotes", "Investigation Narrative"), ...base],
  },
  {
    code: "NEAR_MISS", value: "Near Miss", label: "Near Miss", description: "A close call without actual contact where a collision or serious incident could reasonably have occurred.", group: "Safety", sources: options.source, evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS", "INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("nearMissType", "Near-Miss Configuration", ["Rear-End Risk", "Lane Conflict", "Pedestrian Conflict", "Intersection Conflict", "Backing Conflict", "Rollover Risk", "Other"], { required: true }), select("triggerSource", "Trigger Source", options.trigger, { required: true }), text("otherPartyObject", "Other Party / Object"), number("distanceToImpact", "Distance to Impact", "m"), number("timeToCollision", "Time to Collision", "s"), number("speed", "Vehicle Speed", "mph / km/h"), text("avoidanceAction", "Avoidance Action"), select("zoneType", "Zone Type", options.zone), area("contextNotes", "Context / Circumstances"), ...base],
  },
  {
    code: "ROADSIDE_INSPECTION", value: "Roadside Inspection", label: "Roadside Inspection", description: "An enforcement inspection with inspection level, result, violations, and linked regulatory evidence.", group: "Regulatory", sources: ["Roadside Inspection", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("jurisdiction", "Jurisdiction", ["US", "CA"], { required: true }), select("inspectionRegime", "Inspection Regime", ["US_CVSA", "CA_NSC_CVSA", "OTHER"], { required: true }), select("inspectionClassification", "Inspection Level / Type", ["US_LEVEL_I", "US_LEVEL_II", "US_LEVEL_III", "US_LEVEL_IV", "US_LEVEL_V", "US_LEVEL_VI", "US_LEVEL_VII", "US_LEVEL_VIII", "CA_TYPE_1", "CA_TYPE_2", "CA_TYPE_3", "CA_TYPE_4", "CA_TYPE_5", "OTHER"], { required: true, optionsWhen: { inspectionRegime: { US_CVSA: ["US_LEVEL_I", "US_LEVEL_II", "US_LEVEL_III", "US_LEVEL_IV", "US_LEVEL_V", "US_LEVEL_VI", "US_LEVEL_VII", "US_LEVEL_VIII"], CA_NSC_CVSA: ["CA_TYPE_1", "CA_TYPE_2", "CA_TYPE_3", "CA_TYPE_4", "CA_TYPE_5"], OTHER: ["OTHER"] } } }), text("agency", "Enforcement Agency"), select("inspectionResult", "Inspection Result", [{ value: "CLEAN", label: "Clean" }, { value: "VIOLATIONS_FOUND", label: "Violations Found" }, { value: "OUT_OF_SERVICE", label: "Out of Service" }, { value: "OTHER_REVIEW_REQUIRED", label: "Other / Review Required" }], { required: true }), number("driverViolationsCount", "Driver Violations", "count"), number("vehicleViolationsCount", "Vehicle Violations", "count"), number("hosViolationsCount", "HOS Violations", "count"), bool("driverOOS", "Driver OOS Issued"), bool("vehicleOOS", "Vehicle OOS Issued"), bool("hazmatInspected", "Hazmat Inspected"), select("oosType", "OOS Type", CONTROLLED.oosType), date("oosReleaseDate", "OOS Release Date"), ...base],
  },
  {
    code: "OUT_OF_SERVICE_ORDER", value: "Out-of-Service Order", label: "Out-of-Service Order", description: "A documented out-of-service order and its governing source, scope, release, and evidence.", group: "Regulatory", sources: ["Roadside Inspection", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle", policy: DOCUMENT_POLICY, relationships: oosRelationships,
    fields: [
      select("jurisdiction", "Jurisdiction", jurisdictionOptions, { required: true, helpText: "Select the canonical state/province. Country is derived automatically." }),
      select("oosScope", "OOS Scope", CONTROLLED.oosScope, { required: true }),
      select("relatedHOS", "Related to HOS?", CONTROLLED.yesNoUnknown, { required: true }),
      select("citationIssued", "Citation Issued?", CONTROLLED.yesNoUnknown, { required: true }),
      select("maintenanceRequired", "Maintenance / Repair Required?", CONTROLLED.yesNoUnknown, { required: true }),
      select("trainingRequired", "Training Required?", CONTROLLED.yesNoUnknown, { required: true }),
      text("issuingAgency", "Issuing Agency"), select("oosType", "OOS Type", CONTROLLED.oosType), date("issuedDate", "Issued Date", { required: true }), date("releaseDate", "Release Date"), text("releaseAuthority", "Release Authority"), area("basis", "Order Basis"),
      area("otherScopeExplanation", "Scope Explanation", { applicability: [{ state: "CONDITIONAL", when: { oosScope: ["OTHER"] } }] }),
      ...base,
    ],
  },
  {
    code: "HOS_VIOLATION", value: "HOS Violation", label: "HOS Violation", description: "A source-supported HOS condition linked to the existing HOS source, calculation, and review architecture.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Roadside Inspection", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("ruleJurisdiction", "Rule Jurisdiction", ["CA_FEDERAL", "US_FMCSA", "US_TEXAS_INTRASTATE", "US_CALIFORNIA_INTRASTATE", "Canada (Federal 70h/7d)", "US (FMCSA 70h/8d)", "Texas Intrastate", "California Intrastate"], { required: true }), text("violationType", "Violation Type", { required: true }), date("logDate", "Log Date", { required: true }), select("detectionSource", "Detection Source", ["ELD Live Telematics", "Roadside Inspection", "Internal Audit"], { required: true }), number("hoursExceeded", "Hours Exceeded", "hours"), text("eldProvider", "ELD / Provider"), select("reviewStatus", "Review State", ["Potential", "Under Review", "Confirmed", "Not a Violation", "Unable to Determine", "Disputed", "Resolved"]), area("reviewNotes", "Review Notes"), ...base],
  },
  {
    code: "TRAFFIC_CITATION", value: "Traffic Citation", label: "Traffic Citation", description: "A traffic citation occurrence linked to the authoritative Citation record when available.", group: "Regulatory", sources: ["Citation", "Roadside Inspection", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("citationNumber", "Citation Number", { helpText: "Prefer the canonical Citation relationship when available." }), text("violationCode", "Violation Code"), number("fineAmount", "Fine Amount", "currency"), number("pointsAssessed", "Points Assessed", "points"), text("courtJurisdiction", "Court Jurisdiction"), date("courtDate", "Court Date"), select("disposition", "Disposition", options.citationDisposition), ...base],
  },
  {
    code: "CARGO_DAMAGE", value: "Cargo Damage", label: "Cargo Damage", description: "Documented cargo damage with measurable scope, context, and evidence.", group: "Operations", sources: ["Driver Report", "Customer", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("cargoIssueType", "Cargo Issue", options.cargoType, { required: true }), text("cargoDescription", "Cargo Description"), number("quantityAffected", "Quantity Affected", "count"), number("estimatedLossAmount", "Estimated Loss", "currency"), bool("packagingFailure", "Packaging Failure Observed"), bool("securementConcern", "Securement Concern"), area("damageNotes", "Damage Narrative"), ...base],
  },
  {
    code: "CARGO_THEFT", value: "Cargo Theft", label: "Cargo Theft", description: "A documented cargo loss/theft occurrence with chain-of-custody and security facts.", group: "Security", sources: ["Driver Report", "Customer", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [number("estimatedLossAmount", "Estimated Loss", "currency"), text("lastKnownLocation", "Last Known Location"), date("lastKnownDate", "Last Known Date"), bool("sealCompromised", "Seal Compromised"), area("theftNarrative", "Theft / Loss Narrative"), ...base],
  },
  {
    code: "SPILL_RELEASE", value: "Spill or Release", label: "Spill or Release", description: "A documented environmental spill or release occurrence with material, quantity, response, and evidence.", group: "Safety", sources: ["Driver Report", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS", "INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("material", "Material / Substance", { required: true }), number("quantityReleased", "Quantity Released", "dynamic"), select("releaseEnvironment", "Release Environment", ["Roadway", "Customer Site", "Water", "Soil", "Vehicle / Equipment", "Contained", "Unknown", "Other"]), bool("containmentPerformed", "Containment Performed"), bool("emergencyResponse", "Emergency Response"), area("responseNotes", "Response Narrative"), ...base],
  },
  {
    code: "CUSTOMER_COMPLAINT", value: "Customer Complaint", label: "Customer Complaint", description: "A customer-reported service concern captured separately from the later substantiation determination.", group: "Customer", sources: ["Customer", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["COMPLAINT_SUBSTANTIATION", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [text("customerName", "Customer / Shipper Name", { required: true }), select("complaintCategory", "Complaint Category", options.complaintCategory, { required: true }), date("receivedDate", "Complaint Received Date"), area("complaintNarrative", "Complaint Narrative", { required: true }), select("substantiationStatus", "Review State", options.complaintState), ...base],
  },
  {
    code: "CUSTOMER_COMMENDATION", value: "Customer Commendation", label: "Customer Commendation", description: "Positive customer evidence about objectively supported driver service or safety performance.", group: "Positive", sources: ["Customer", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [text("customerName", "Customer Name"), select("commendationType", "Commendation Type", ["Customer Commendation", "Safe Driving Milestone", "Roadside Clean Inspection", "Peer Commendation", "Community Service"], { required: true }), text("recognizedBy", "Recognized By", { required: true }), date("recognitionDate", "Recognition Date"), area("recognitionNarrative", "Recognition Narrative"), ...base],
  },
  {
    code: "POSITIVE_SAFETY_OBSERVATION", value: "Positive Safety Observation", label: "Positive Safety Observation", description: "Positive operational evidence based on a documented safety observation rather than absence of adverse records.", group: "Positive", sources: ["Company Staff", "Camera", "Customer", "Driver Report", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("observationType", "Observation Type", options.observationType, { required: true }), text("observer", "Observer", { required: true }), date("observationDate", "Observation Date"), area("observationNarrative", "Observation Narrative", { required: true }), ...base],
  },
  {
    code: "COACHING_SESSION", value: "Coaching Session", label: "Coaching Session", description: "A performance-related occurrence that may reference a separate Company Action; the event does not own the action.", group: "Operations", sources: ["Company Staff", "Other"], evidenceRequired: false, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("topic", "Topic", { required: true }), date("sessionDate", "Session Date"), area("discussionSummary", "Discussion Summary"), area("observedFacts", "Observed Facts"), ...base],
  },
  {
    code: "DISCIPLINARY_ACTION", value: "Disciplinary Action", label: "Disciplinary Action", description: "A legacy-compatible event projection; authoritative disciplinary action remains a separate Company Action record.", group: "Operations", sources: ["Company Staff", "Other"], evidenceRequired: false, determinationTypes: [], analyticsEligible: false, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [select("actionType", "Action Type", ["Verbal Warning", "Written Warning", "Final Warning", "Suspension", "Safety Retraining Required", "Other"]), date("effectiveDate", "Effective Date"), area("factualBasis", "Factual Basis"), ...base],
  },
  {
    code: "CORRECTIVE_ACTION_PLAN", value: "Corrective Action Plan", label: "Corrective Action Plan", description: "A reference/projection to a separate corrective Company Action Plan, preserving the event/action ownership boundary.", group: "Operations", sources: ["Company Staff", "Other"], evidenceRequired: false, determinationTypes: ["CORRECTIVE_ACTION_OUTCOME"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [date("targetDate", "Target Date"), select("planState", "Plan State", ["Open", "In Progress", "Awaiting Verification", "Completed", "Closed"]), area("planContext", "Plan Context"), ...base],
  },
  {
    code: "INJURY", value: "Injury", label: "Injury", description: "An operational injury occurrence with restricted detail and reference to authoritative screening/medical records where applicable.", group: "Safety", sources: ["Driver Report", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("injuryContext", "Injury Context", ["Workplace", "Vehicle Operation", "Loading / Unloading", "Customer Site", "Roadside", "Other"]), date("injuryDate", "Injury Date"), bool("dutyImpact", "Duty Impact"), select("fitnessState", "Fitness / Restriction State", CONTROLLED.fitnessState), date("effectiveDate", "Effective Date"), area("operationalNotes", "Operational / Compliance Notes"), ...base],
  },
  {
    code: "SECURITY_INCIDENT", value: "Security Incident", label: "Security Incident", description: "A security occurrence with structured incident type, reference, location, and response facts.", group: "Security", sources: ["Driver Report", "Company Staff", "Camera", "Customer", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("securityType", "Security Incident Type", options.securityType, { required: true }), text("affectedAsset", "Affected Asset"), bool("lawEnforcementNotified", "Law Enforcement Notified"), area("incidentNarrative", "Incident Narrative"), ...base],
  },
  {
    code: "WARNING", value: "Warning", label: "Warning", description: "A documented warning or notice with its issuing source and factual basis.", group: "Regulatory", sources: ["Roadside Inspection", "Citation", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("issuingAuthority", "Issuing Authority"), select("warningType", "Warning Type", ["Traffic", "Safety", "Regulatory", "Customer", "Internal", "Other"], { required: true }), area("basis", "Factual Basis"), ...base],
  },
  {
    code: "VIOLATION", value: "Violation", label: "Violation", description: "A source-supported operational or regulatory violation represented without conflating it with a later company determination.", group: "Regulatory", sources: ["Roadside Inspection", "Citation", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("violationType", "Violation Family", options.violationType, { required: true }), text("violationCode", "Violation Code"), text("regulatorySource", "Regulatory Source"), area("violationDescription", "Violation Description", { required: true }), ...base],
  },
  {
    code: "CITATION_LINKED_EVENT", value: "Citation-linked Event", label: "Citation-linked Event", description: "A performance event whose occurrence is linked to an authoritative Citation record.", group: "Regulatory", sources: ["Citation", "Company Staff", "Roadside Inspection"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("citationNumber", "Citation Number"), text("linkedEventContext", "Event Context"), area("notes", "Contextual Notes"), ...base],
  },
  {
    code: "EQUIPMENT_FAILURE", value: "Equipment Failure / Critical Defect", label: "Equipment Failure / Critical Defect", description: "An equipment occurrence preserving the distinction between mechanical facts and any later attribution to driver, vehicle, or company.", group: "Operations", sources: ["Maintenance", "Driver Report", "Camera", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("equipmentIssueType", "Equipment Issue", ["Mechanical Failure", "Defect", "Warning", "Damage", "Breakdown", "Inspection Finding", "Other"], { required: true }), text("vehicleContext", "Vehicle Context"), bool("defectReported", "Defect Reported by Driver"), date("reportedDate", "Defect Report Date"), area("equipmentNarrative", "Equipment Narrative"), ...base],
  },
  {
    code: "SAFETY_OBSERVATION", value: "Safety Observation", label: "Safety Observation", description: "A factual safety observation, positive or adverse, without automatically assigning fault.", group: "Safety", sources: ["Company Staff", "Camera", "Driver Report", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("observationType", "Observation Type", ["Driving", "Equipment", "Procedure", "PPE", "Site", "Cargo", "Other"], { required: true }), select("observationState", "Observation State", ["Positive", "Neutral", "Concern"], { required: true }), text("observer", "Observer"), area("observationNarrative", "Observation Narrative", { required: true }), ...base],
  },
  {
    code: "CUSTOMER_COMPLIMENT", value: "Customer Compliment", label: "Customer Compliment", description: "A positive customer record distinct from a Customer Commendation when the source is less formal.", group: "Positive", sources: ["Customer", "Company Staff", "Other"], evidenceRequired: false, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [text("customerName", "Customer Name"), text("recognizedBy", "Recognized By"), date("complimentDate", "Compliment Date"), area("complimentNarrative", "Compliment Narrative", { required: true }), ...base],
  },
  {
    code: "TELEMATICS_CAMERA_OBSERVATION", value: "Telematics / Camera Observation", label: "Telematics / Camera Observation", description: "A measured or observed telematics/camera occurrence preserving original measurement and threshold provenance.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [text("provider", "Provider"), text("observationType", "Observation Type", { required: true }), number("rawValue", "Raw Measurement", "dynamic"), number("thresholdValue", "Threshold", "dynamic"), text("thresholdSource", "Threshold Source"), text("thresholdId", "Threshold ID"), text("thresholdVersion", "Threshold Version"), date("thresholdEffectiveDate", "Threshold Effective Date"), number("variance", "Threshold Variance", "dynamic"), number("durationSeconds", "Duration", "seconds"), number("peakValue", "Peak", "dynamic"), number("averageValue", "Average", "dynamic"), ...base],
  },
  {
    code: "SECURITY_EVENT", value: "Security Event", label: "Security Event", description: "A structured security event distinct from a later investigation finding or company action.", group: "Security", sources: ["Driver Report", "Company Staff", "Camera", "Customer", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("securityType", "Security Type", options.securityType, { required: true }), bool("accessCompromised", "Access Compromised"), area("eventNarrative", "Event Narrative"), ...base],
  },
  {
    code: "EMERGENCY_EVENT", value: "Emergency Event", label: "Emergency Event", description: "An emergency occurrence with structured event type, response, operational impact, and evidence.", group: "Safety", sources: ["Driver Report", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("emergencyType", "Emergency Type", options.emergencyType, { required: true }), bool("emergencyServices", "Emergency Services Involved"), number("downtimeHours", "Operational Downtime", "hours"), area("emergencyNarrative", "Emergency Narrative", { required: true }), ...base],
  },

  {
    code: "SPEEDING", value: "Speeding", label: "Speeding", description: "A measurement-driven speed threshold event preserving original speed, applicable limit, variance, duration, and threshold provenance.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("thresholdBasis", "Threshold Basis", CONTROLLED.thresholdBasis, { required: true }), number("actualSpeed", "Actual / Trigger Speed", "mph / km/h", { required: true }), number("postedSpeedLimit", "Posted Speed Limit", "mph / km/h"), number("companyThreshold", "Company Threshold", "mph / km/h"), number("applicableThreshold", "Applicable Threshold", "mph / km/h"), number("amountExceeded", "Amount Exceeded", "speed unit"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakSpeed", "Peak Speed", "mph / km/h"), number("averageSpeed", "Average Speed", "mph / km/h"), select("zoneType", "Zone Type", options.zone), select("loadStatus", "Load Status", options.loadStatus), text("provider", "Provider"), text("thresholdVersion", "Threshold Version"), date("thresholdEffectiveDate", "Threshold Effective Date"), ...base],
  },
  {
    code: "HARSH_BRAKING", value: "Harsh Braking", label: "Harsh Braking", description: "A measured braking threshold event; TES records the measurement and context without automatically judging driver intent or fault.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("triggerDeceleration", "Trigger Deceleration", "m/sÂ²", { required: true }), number("threshold", "Threshold", "m/sÂ²", { required: true }), number("thresholdVariance", "Threshold Variance", "m/sÂ²"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakDeceleration", "Peak Deceleration", "m/sÂ²"), number("averageDeceleration", "Average Deceleration", "m/sÂ²"), number("speedAtTrigger", "Speed at Trigger", "mph / km/h"), number("endingSpeed", "Ending Speed", "mph / km/h"), number("distanceMeters", "Distance", "m"), number("roadGrade", "Road Grade", "%"), select("weather", "Weather", options.weather), select("roadSurface", "Road Surface", options.road), select("lighting", "Lighting", options.lighting), select("traffic", "Traffic", CONTROLLED.trafficCondition), select("loadStatus", "Load Status", options.loadStatus), bool("forwardCollisionWarning", "Forward Collision Warning"), text("provider", "Provider"), text("thresholdVersion", "Threshold Version"), ...base],
  },
  {
    code: "HARSH_ACCELERATION", value: "Harsh Acceleration", label: "Harsh Acceleration", description: "A measured acceleration threshold event preserving measurement, threshold, exposure, and context.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("triggerAcceleration", "Trigger Acceleration", "m/sÂ²", { required: true }), number("threshold", "Threshold", "m/sÂ²", { required: true }), number("variance", "Threshold Variance", "m/sÂ²"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakAcceleration", "Peak Acceleration", "m/sÂ²"), number("averageAcceleration", "Average Acceleration", "m/sÂ²"), number("triggerSpeed", "Trigger Speed", "mph / km/h"), number("endingSpeed", "Ending Speed", "mph / km/h"), number("distanceMeters", "Distance", "m"), select("loadStatus", "Load Status", options.loadStatus), select("weather", "Weather", options.weather), select("road", "Road", options.road), select("lighting", "Lighting", options.lighting), ...base],
  },
  {
    code: "HARSH_CORNERING", value: "Harsh Cornering", label: "Harsh Cornering", description: "A measured lateral-acceleration event preserving road geometry, load, and environmental context.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("lateralAcceleration", "Lateral Acceleration", "m/sÂ²", { required: true }), number("threshold", "Threshold", "m/sÂ²", { required: true }), number("variance", "Threshold Variance", "m/sÂ²"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakLateralAcceleration", "Peak Lateral Acceleration", "m/sÂ²"), number("averageLateralAcceleration", "Average Lateral Acceleration", "m/sÂ²"), number("speed", "Speed", "mph / km/h"), number("turnRadius", "Turn Radius", "m"), select("loadStatus", "Load Status", options.loadStatus), text("roadGeometry", "Road Geometry"), select("weather", "Weather", options.weather), select("roadSurface", "Road Surface", options.road), ...base],
  },
  {
    code: "FOLLOWING_DISTANCE", value: "Following Distance", label: "Following Distance", description: "A measured time/distance-gap event preserving the applicable threshold and original measurement basis.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("timeGapSeconds", "Time Gap", "seconds", { required: true }), number("timeGapThresholdSeconds", "Applicable Time-Gap Threshold", "seconds", { required: true }), number("timeGapVarianceSeconds", "Time-Gap Variance", "seconds"), number("distanceGapMeters", "Distance Gap", "m"), number("distanceThresholdMeters", "Applicable Distance Threshold", "m"), number("distanceVarianceMeters", "Distance Variance", "m"), number("durationSeconds", "Duration", "seconds"), number("minimumTimeGapSeconds", "Minimum Time Gap", "seconds"), number("minimumDistanceGapMeters", "Minimum Distance Gap", "m"), number("driverVehicleSpeed", "Driver Vehicle Speed", "mph / km/h"), number("leadVehicleSpeed", "Lead Vehicle Speed", "mph / km/h"), number("relativeSpeed", "Relative Speed", "mph / km/h"), number("distanceTraveledMeters", "Distance Traveled", "m"), select("loadStatus", "Load Status", options.loadStatus), ...base],
  },
  {
    code: "FATIGUE_INDICATOR", value: "Fatigue Indicator", label: "Fatigue Indicator", description: "A source/system indicator of possible fatigue-related conditions; it is not a medical diagnosis.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("indicatorType", "Indicator Type", ["Eye Closure", "PERCLOS", "Yawning", "Microsleep Indicator", "Head-Pose Deviation", "Hours Driven", "Time Since Break", "Time of Day", "Consecutive Driving Days", "HOS Proximity", "Other"], { required: true }), number("eyeClosureDurationMs", "Eye Closure Duration", "ms"), number("perclosPercent", "PERCLOS", "%"), number("hoursDriven", "Hours Driven", "hours"), number("timeSinceBreakMinutes", "Time Since Break", "minutes"), number("consecutiveDrivingDays", "Consecutive Driving Days", "days"), select("dutyContext", "Duty Context", CONTROLLED.dutyContext), select("hosProximity", "HOS Proximity", CONTROLLED.hosProximity), select("sourceClassification", "Source Classification", ["SOURCE_MEASUREMENT", "SYSTEM_DERIVED_INDICATOR"]), area("indicatorNotes", "Operational Context / Notes"), ...base],
  },
  {
    code: "DEVICE_DATA_INTEGRITY", value: "Device / Data Integrity", label: "Device / Data Integrity", description: "A device or data integrity occurrence that distinguishes malfunction, anomaly, suspected interference, and confirmed tampering.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [select("integrityState", "Integrity State", options.dataIntegrity, { required: true }), select("deviceType", "Device Type", CONTROLLED.deviceType, { required: true }), select("anomalyType", "Event / Anomaly Type", CONTROLLED.anomalyType), select("interferenceMethod", "Interference Method", CONTROLLED.interferenceMethod), select("dataImpact", "Data Impact", CONTROLLED.dataImpact), date("detectionDate", "Detection Date"), time("detectionTime", "Detection Time"), bool("deviceDisabled", "Device Disabled"), number("dataLossDurationMinutes", "Data Loss Duration", "minutes"), select("dataRecoveryState", "Data Recovery State", ["Not Required", "Pending", "Recovered", "Partially Recovered", "Not Recovered"]), ...base],
  },
  {
    code: "TRIP_SERVICE_PERFORMANCE", value: "Trip Completion / Service Performance", label: "Trip Completion / Service Performance", description: "A deterministic trip or customer-service performance occurrence using scheduled and actual timestamps rather than subjective scoring.", group: "Operations", sources: ["Company Staff", "Customer", "Driver Report", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("serviceType", "Service Type", CONTROLLED.serviceType), date("scheduledDate", "Scheduled Date"), time("scheduledTime", "Scheduled Time"), date("actualDate", "Actual Date"), time("actualTime", "Actual Time"), number("calculatedVarianceMinutes", "Calculated Variance", "minutes"), text("serviceMetric", "Service Metric"), number("metricValue", "Metric Value", "dynamic"), number("metricThreshold", "Metric Threshold", "dynamic"), select("notificationState", "Notification State", CONTROLLED.notificationState), select("acknowledgementState", "Acknowledgement State", CONTROLLED.acknowledgementState), ...base],
  },
  {
    code: "LANE_DEPARTURE", value: "Lane Departure", label: "Lane Departure", description: "A source-detected lane-position event preserving measurement and roadway context without automatic fault attribution.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("durationSeconds", "Duration", "seconds"), number("lateralDeviationMeters", "Lateral Deviation", "m"), number("speed", "Speed", "mph / km/h"), select("laneType", "Lane Type", ["Travel Lane", "Shoulder", "Merge", "Exit", "Other", "Unknown"]), select("roadType", "Road Type", ["Highway", "Urban", "Rural", "Work Zone", "Other"]), select("weather", "Weather", options.weather), ...base],
  },
  {
    code: "SEATBELT", value: "Seatbelt", label: "Seatbelt", description: "A source-supported seatbelt status event preserving detection source and duration where available.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera", "Roadside Inspection", "Company Staff"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("seatbeltState", "Seatbelt State", ["Not Detected", "Unfastened", "Fastened", "Unable to Determine"], { required: true }), number("durationSeconds", "Duration", "seconds"), number("speed", "Vehicle Speed", "mph / km/h"), text("provider", "Provider"), ...base],
  },
  {
    code: "DISTRACTED_DRIVING", value: "Distracted Driving", label: "Distracted Driving", description: "A source-supported distraction indicator; TES records the observed condition without inferring intent or medical cause.", group: "Safety", sources: ["Camera", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("distractionType", "Distraction Type", ["Mobile Device", "In-Cab Device", "Food / Drink", "Passenger", "Looking Away", "Other"], { required: true }), number("durationSeconds", "Duration", "seconds"), number("speed", "Vehicle Speed", "mph / km/h"), area("observedContext", "Observed Context"), ...base],
  },
  {
    code: "IDLE_TIME", value: "Idle Time", label: "Idle Time", description: "A measured idling interval preserving duration, location, operating context, and applicable threshold.", group: "Operations", sources: ["ELD / Telematics", "Company Staff"], evidenceRequired: false, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("durationMinutes", "Idle Duration", "minutes", { required: true }), number("thresholdMinutes", "Applicable Threshold", "minutes"), number("varianceMinutes", "Threshold Variance", "minutes"), select("locationType", "Location Type", ["Customer Site", "Yard", "Rest Area", "Fuel Stop", "Traffic", "Other"]), select("loadStatus", "Load Status", options.loadStatus), ...base],
  },
  {
    code: "ROUTE_DEVIATION", value: "Route Deviation", label: "Route Deviation", description: "A route-variance occurrence preserving planned versus actual route context and measurable deviation.", group: "Operations", sources: ["ELD / Telematics", "Company Staff", "Driver Report"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [number("deviationDistanceMiles", "Deviation Distance", "miles"), number("deviationDurationMinutes", "Deviation Duration", "minutes"), text("deviationReason", "Reported Reason"), ...base],
  },
  {
    code: "BACKING", value: "Backing", label: "Backing", description: "A backing maneuver occurrence with structured maneuver, environment, and outcome facts.", group: "Safety", sources: ["Driver Report", "Camera", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("maneuverType", "Maneuver Type", ["Straight Back", "Offset Back", "Dock", "Alley", "Customer Site", "Other"], { required: true }), select("spotterUsed", "Spotter Used", ["Yes", "No", "Not Applicable", "Unknown"]), bool("contactOccurred", "Contact Occurred"), text("objectContacted", "Object Contacted"), select("siteType", "Site Type", ["Yard", "Customer Site", "Public Road", "Other"]), ...base],
  },
  {
    code: "STOP_SIGN_RED_LIGHT", value: "Stop Sign / Red Light", label: "Stop Sign / Red Light", description: "A documented stop-control event with source, control type, and measurable context where available.", group: "Safety", sources: ["Camera", "Roadside Inspection", "Citation", "Driver Report"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("controlType", "Control Type", ["Stop Sign", "Red Light", "Rail Signal", "Other"], { required: true }), select("observedOutcome", "Observed Outcome", ["Stopped", "Rolling Stop", "Failed to Stop", "Unable to Determine"]), number("speedAtControl", "Speed at Control", "mph / km/h"), ...base],
  },
  {
    code: "RAILROAD_CROSSING", value: "Railroad Crossing", label: "Railroad Crossing", description: "A railroad-crossing occurrence preserving crossing status, control, and safety context.", group: "Safety", sources: ["Camera", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("crossingType", "Crossing Type", ["Active Warning", "Passive", "Private", "Unknown"]), select("observedAction", "Observed Action", ["Stopped as Required", "Crossed", "Stopped Short", "Unable to Determine"]), bool("trainPresent", "Train Present"), bool("gatesDown", "Gates Down"), ...base],
  },
  {
    code: "CUSTOMER_SITE_BEHAVIOR", value: "Customer-Site Behavior", label: "Customer-Site Behavior", description: "A customer-site operational occurrence with site, behavior, and evidence context.", group: "Customer", sources: ["Customer", "Company Staff", "Driver Report", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("behaviorType", "Behavior Type", ["Safe Site Practice", "Access / Conduct", "Dock Conduct", "PPE", "Communication", "Other"], { required: true }), area("behaviorNarrative", "Behavior Narrative", { required: true }), ...base],
  },
  {
    code: "PPE_SAFETY_PROTOCOL", value: "PPE / Safety Protocol", label: "PPE / Safety Protocol", description: "A documented PPE or site-safety protocol observation with the applicable requirement and observed state.", group: "Safety", sources: ["Company Staff", "Customer", "Driver Report", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("protocolType", "Protocol Type", ["PPE", "Fall Protection", "Lockout / Tagout", "Site Speed", "Spotter", "Other"], { required: true }), select("observedState", "Observed State", ["Compliant", "Non-Compliant", "Unable to Determine"], { required: true }), text("requirementSource", "Requirement Source"), area("observationNarrative", "Observation Narrative"), ...base],
  },
];


const EXPLICIT_CATEGORY_DATA_POINT_IDS: Readonly<Record<string, string>> = {
  'COLLISION:collisionType': 'DRV.PERF.COLLISION.COLLISIONTYPE',
  'COLLISION:otherPartyObject': 'DRV.PERF.COLLISION.OTHERPARTYOBJECT',
  'COLLISION:weather': 'DRV.PERF.SHARED.WEATHER_CONDITION',
  'COLLISION:roadCondition': 'DRV.PERF.SHARED.ROAD_SURFACE',
  'COLLISION:lightCondition': 'DRV.PERF.SHARED.LIGHTING_CONDITION',
  'COLLISION:speedAtOccurrence': 'DRV.PERF.COLLISION.SPEEDATOCCURRENCE',
  'COLLISION:injuriesCount': 'DRV.PERF.COLLISION.INJURIESCOUNT',
  'COLLISION:fatalitiesCount': 'DRV.PERF.COLLISION.FATALITIESCOUNT',
  'COLLISION:towRequired': 'DRV.PERF.COLLISION.TOWREQUIRED',
  'COLLISION:policeAttended': 'DRV.PERF.COLLISION.POLICEATTENDED',
  'COLLISION:propertyDamage': 'DRV.PERF.COLLISION.PROPERTYDAMAGE',
  'COLLISION:reportabilityResult': 'DRV.PERF.COLLISION.REPORTABILITYRESULT',
  'COLLISION:downtimeHours': 'DRV.PERF.COLLISION.DOWNTIMEHOURS',
  'COLLISION:driverStatement': 'DRV.PERF.COLLISION.DRIVERSTATEMENT',
  'COLLISION:investigationNotes': 'DRV.PERF.COLLISION.INVESTIGATIONNOTES',
  'NEAR_MISS:nearMissType': 'DRV.PERF.NEAR_MISS.NEARMISSTYPE',
  'NEAR_MISS:triggerSource': 'DRV.PERF.NEAR_MISS.TRIGGERSOURCE',
  'NEAR_MISS:otherPartyObject': 'DRV.PERF.NEAR_MISS.OTHERPARTYOBJECT',
  'NEAR_MISS:distanceToImpact': 'DRV.PERF.NEAR_MISS.DISTANCETOIMPACT',
  'NEAR_MISS:timeToCollision': 'DRV.PERF.NEAR_MISS.TIMETOCOLLISION',
  'NEAR_MISS:speed': 'DRV.PERF.NEAR_MISS.SPEED',
  'NEAR_MISS:avoidanceAction': 'DRV.PERF.NEAR_MISS.AVOIDANCEACTION',
  'NEAR_MISS:zoneType': 'DRV.PERF.SHARED.ZONE_TYPE',
  'NEAR_MISS:contextNotes': 'DRV.PERF.NEAR_MISS.CONTEXTNOTES',
  'ROADSIDE_INSPECTION:jurisdiction': 'DRV.PERF.ROADSIDE_INSPECTION.JURISDICTION',
  'ROADSIDE_INSPECTION:inspectionRegime': 'DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONREGIME',
  'ROADSIDE_INSPECTION:inspectionClassification': 'DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONCLASSIFICATION',
  'ROADSIDE_INSPECTION:agency': 'DRV.PERF.ROADSIDE_INSPECTION.AGENCY',
  'ROADSIDE_INSPECTION:inspectionResult': 'DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONRESULT',
  'ROADSIDE_INSPECTION:driverViolationsCount': 'DRV.PERF.ROADSIDE_INSPECTION.DRIVERVIOLATIONSCOUNT',
  'ROADSIDE_INSPECTION:vehicleViolationsCount': 'DRV.PERF.ROADSIDE_INSPECTION.VEHICLEVIOLATIONSCOUNT',
  'ROADSIDE_INSPECTION:hosViolationsCount': 'DRV.PERF.ROADSIDE_INSPECTION.HOSVIOLATIONSCOUNT',
  'ROADSIDE_INSPECTION:driverOOS': 'DRV.PERF.ROADSIDE_INSPECTION.DRIVEROOS',
  'ROADSIDE_INSPECTION:vehicleOOS': 'DRV.PERF.ROADSIDE_INSPECTION.VEHICLEOOS',
  'ROADSIDE_INSPECTION:hazmatInspected': 'DRV.PERF.ROADSIDE_INSPECTION.HAZMATINSPECTED',
  'ROADSIDE_INSPECTION:oosType': 'DRV.PERF.ROADSIDE_INSPECTION.OOSTYPE',
  'ROADSIDE_INSPECTION:oosReleaseDate': 'DRV.PERF.ROADSIDE_INSPECTION.OOSRELEASEDATE',
  'OUT_OF_SERVICE_ORDER:issuingAgency': 'DRV.PERF.OUT_OF_SERVICE_ORDER.ISSUINGAGENCY',
  'OUT_OF_SERVICE_ORDER:oosType': 'DRV.PERF.OUT_OF_SERVICE_ORDER.OOSTYPE',
  'OUT_OF_SERVICE_ORDER:issuedDate': 'DRV.PERF.OUT_OF_SERVICE_ORDER.ISSUEDDATE',
  'OUT_OF_SERVICE_ORDER:releaseDate': 'DRV.PERF.OUT_OF_SERVICE_ORDER.RELEASEDATE',
  'OUT_OF_SERVICE_ORDER:releaseAuthority': 'DRV.PERF.OUT_OF_SERVICE_ORDER.RELEASEAUTHORITY',
  'OUT_OF_SERVICE_ORDER:basis': 'DRV.PERF.OUT_OF_SERVICE_ORDER.BASIS',
  'HOS_VIOLATION:ruleJurisdiction': 'DRV.PERF.HOS_VIOLATION.RULEJURISDICTION',
  'HOS_VIOLATION:violationType': 'DRV.PERF.HOS_VIOLATION.VIOLATIONTYPE',
  'HOS_VIOLATION:logDate': 'DRV.PERF.HOS_VIOLATION.LOGDATE',
  'HOS_VIOLATION:detectionSource': 'DRV.PERF.HOS_VIOLATION.DETECTIONSOURCE',
  'HOS_VIOLATION:hoursExceeded': 'DRV.PERF.HOS_VIOLATION.HOURSEXCEEDED',
  'HOS_VIOLATION:eldProvider': 'DRV.PERF.HOS_VIOLATION.ELDPROVIDER',
  'HOS_VIOLATION:reviewStatus': 'DRV.PERF.HOS_VIOLATION.REVIEWSTATUS',
  'HOS_VIOLATION:reviewNotes': 'DRV.PERF.HOS_VIOLATION.REVIEWNOTES',
  'TRAFFIC_CITATION:citationNumber': 'DRV.PERF.TRAFFIC_CITATION.CITATIONNUMBER',
  'TRAFFIC_CITATION:violationCode': 'DRV.PERF.TRAFFIC_CITATION.VIOLATIONCODE',
  'TRAFFIC_CITATION:fineAmount': 'DRV.PERF.TRAFFIC_CITATION.FINEAMOUNT',
  'TRAFFIC_CITATION:pointsAssessed': 'DRV.PERF.TRAFFIC_CITATION.POINTSASSESSED',
  'TRAFFIC_CITATION:courtJurisdiction': 'DRV.PERF.TRAFFIC_CITATION.COURTJURISDICTION',
  'TRAFFIC_CITATION:courtDate': 'DRV.PERF.TRAFFIC_CITATION.COURTDATE',
  'TRAFFIC_CITATION:disposition': 'DRV.PERF.TRAFFIC_CITATION.DISPOSITION',
  'CARGO_DAMAGE:cargoIssueType': 'DRV.PERF.CARGO_DAMAGE.CARGOISSUETYPE',
  'CARGO_DAMAGE:cargoDescription': 'DRV.PERF.CARGO_DAMAGE.CARGODESCRIPTION',
  'CARGO_DAMAGE:quantityAffected': 'DRV.PERF.CARGO_DAMAGE.QUANTITYAFFECTED',
  'CARGO_DAMAGE:estimatedLossAmount': 'DRV.PERF.CARGO_DAMAGE.ESTIMATEDLOSSAMOUNT',
  'CARGO_DAMAGE:packagingFailure': 'DRV.PERF.CARGO_DAMAGE.PACKAGINGFAILURE',
  'CARGO_DAMAGE:securementConcern': 'DRV.PERF.CARGO_DAMAGE.SECUREMENTCONCERN',
  'CARGO_DAMAGE:damageNotes': 'DRV.PERF.CARGO_DAMAGE.DAMAGENOTES',
  'CARGO_THEFT:estimatedLossAmount': 'DRV.PERF.CARGO_THEFT.ESTIMATEDLOSSAMOUNT',
  'CARGO_THEFT:lastKnownLocation': 'DRV.PERF.CARGO_THEFT.LASTKNOWNLOCATION',
  'CARGO_THEFT:lastKnownDate': 'DRV.PERF.CARGO_THEFT.LASTKNOWNDATE',
  'CARGO_THEFT:sealCompromised': 'DRV.PERF.CARGO_THEFT.SEALCOMPROMISED',
  'CARGO_THEFT:theftNarrative': 'DRV.PERF.CARGO_THEFT.THEFTNARRATIVE',
  'SPILL_RELEASE:material': 'DRV.PERF.SPILL_RELEASE.MATERIAL',
  'SPILL_RELEASE:quantityReleased': 'DRV.PERF.SPILL_RELEASE.QUANTITYRELEASED',
  'SPILL_RELEASE:releaseEnvironment': 'DRV.PERF.SPILL_RELEASE.RELEASEENVIRONMENT',
  'SPILL_RELEASE:containmentPerformed': 'DRV.PERF.SPILL_RELEASE.CONTAINMENTPERFORMED',
  'SPILL_RELEASE:emergencyResponse': 'DRV.PERF.SPILL_RELEASE.EMERGENCYRESPONSE',
  'SPILL_RELEASE:responseNotes': 'DRV.PERF.SPILL_RELEASE.RESPONSENOTES',
  'CUSTOMER_COMPLAINT:customerName': 'DRV.PERF.CUSTOMER_COMPLAINT.CUSTOMERNAME',
  'CUSTOMER_COMPLAINT:complaintCategory': 'DRV.PERF.CUSTOMER_COMPLAINT.COMPLAINTCATEGORY',
  'CUSTOMER_COMPLAINT:receivedDate': 'DRV.PERF.CUSTOMER_COMPLAINT.RECEIVEDDATE',
  'CUSTOMER_COMPLAINT:complaintNarrative': 'DRV.PERF.CUSTOMER_COMPLAINT.COMPLAINTNARRATIVE',
  'CUSTOMER_COMPLAINT:substantiationStatus': 'DRV.PERF.CUSTOMER_COMPLAINT.SUBSTANTIATIONSTATUS',
  'CUSTOMER_COMMENDATION:customerName': 'DRV.PERF.CUSTOMER_COMMENDATION.CUSTOMERNAME',
  'CUSTOMER_COMMENDATION:commendationType': 'DRV.PERF.CUSTOMER_COMMENDATION.COMMENDATIONTYPE',
  'CUSTOMER_COMMENDATION:recognizedBy': 'DRV.PERF.CUSTOMER_COMMENDATION.RECOGNIZEDBY',
  'CUSTOMER_COMMENDATION:recognitionDate': 'DRV.PERF.CUSTOMER_COMMENDATION.RECOGNITIONDATE',
  'CUSTOMER_COMMENDATION:recognitionNarrative': 'DRV.PERF.CUSTOMER_COMMENDATION.RECOGNITIONNARRATIVE',
  'POSITIVE_SAFETY_OBSERVATION:observationType': 'DRV.PERF.POSITIVE_SAFETY_OBSERVATION.OBSERVATIONTYPE',
  'POSITIVE_SAFETY_OBSERVATION:observer': 'DRV.PERF.POSITIVE_SAFETY_OBSERVATION.OBSERVER',
  'POSITIVE_SAFETY_OBSERVATION:observationDate': 'DRV.PERF.POSITIVE_SAFETY_OBSERVATION.OBSERVATIONDATE',
  'POSITIVE_SAFETY_OBSERVATION:observationNarrative': 'DRV.PERF.POSITIVE_SAFETY_OBSERVATION.OBSERVATIONNARRATIVE',
  'COACHING_SESSION:topic': 'DRV.PERF.COACHING_SESSION.TOPIC',
  'COACHING_SESSION:sessionDate': 'DRV.PERF.COACHING_SESSION.SESSIONDATE',
  'COACHING_SESSION:discussionSummary': 'DRV.PERF.COACHING_SESSION.DISCUSSIONSUMMARY',
  'COACHING_SESSION:observedFacts': 'DRV.PERF.COACHING_SESSION.OBSERVEDFACTS',
  'DISCIPLINARY_ACTION:actionType': 'DRV.PERF.DISCIPLINARY_ACTION.ACTIONTYPE',
  'DISCIPLINARY_ACTION:effectiveDate': 'DRV.PERF.DISCIPLINARY_ACTION.EFFECTIVEDATE',
  'DISCIPLINARY_ACTION:factualBasis': 'DRV.PERF.DISCIPLINARY_ACTION.FACTUALBASIS',
  'CORRECTIVE_ACTION_PLAN:targetDate': 'DRV.PERF.CORRECTIVE_ACTION_PLAN.TARGETDATE',
  'CORRECTIVE_ACTION_PLAN:planState': 'DRV.PERF.CORRECTIVE_ACTION_PLAN.PLANSTATE',
  'CORRECTIVE_ACTION_PLAN:planContext': 'DRV.PERF.CORRECTIVE_ACTION_PLAN.PLANCONTEXT',
  'INJURY:injuryContext': 'DRV.PERF.INJURY.INJURYCONTEXT',
  'INJURY:injuryDate': 'DRV.PERF.INJURY.INJURYDATE',
  'INJURY:dutyImpact': 'DRV.PERF.INJURY.DUTYIMPACT',
  'INJURY:fitnessState': 'DRV.PERF.INJURY.FITNESSSTATE',
  'INJURY:effectiveDate': 'DRV.PERF.INJURY.EFFECTIVEDATE',
  'INJURY:operationalNotes': 'DRV.PERF.INJURY.OPERATIONALNOTES',
  'SECURITY_INCIDENT:securityType': 'DRV.PERF.SECURITY_INCIDENT.SECURITYTYPE',
  'SECURITY_INCIDENT:affectedAsset': 'DRV.PERF.SECURITY_INCIDENT.AFFECTEDASSET',
  'SECURITY_INCIDENT:lawEnforcementNotified': 'DRV.PERF.SECURITY_INCIDENT.LAWENFORCEMENTNOTIFIED',
  'SECURITY_INCIDENT:incidentNarrative': 'DRV.PERF.SECURITY_INCIDENT.INCIDENTNARRATIVE',
  'WARNING:issuingAuthority': 'DRV.PERF.WARNING.ISSUINGAUTHORITY',
  'WARNING:warningType': 'DRV.PERF.WARNING.WARNINGTYPE',
  'WARNING:basis': 'DRV.PERF.WARNING.BASIS',
  'VIOLATION:violationType': 'DRV.PERF.VIOLATION.VIOLATIONTYPE',
  'VIOLATION:violationCode': 'DRV.PERF.VIOLATION.VIOLATIONCODE',
  'VIOLATION:regulatorySource': 'DRV.PERF.VIOLATION.REGULATORYSOURCE',
  'VIOLATION:violationDescription': 'DRV.PERF.VIOLATION.VIOLATIONDESCRIPTION',
  'CITATION_LINKED_EVENT:citationNumber': 'DRV.PERF.CITATION_LINKED_EVENT.CITATIONNUMBER',
  'CITATION_LINKED_EVENT:linkedEventContext': 'DRV.PERF.CITATION_LINKED_EVENT.LINKEDEVENTCONTEXT',
  'CITATION_LINKED_EVENT:notes': 'DRV.PERF.CITATION_LINKED_EVENT.NOTES',
  'EQUIPMENT_FAILURE:equipmentIssueType': 'DRV.PERF.EQUIPMENT_FAILURE.EQUIPMENTISSUETYPE',
  'EQUIPMENT_FAILURE:vehicleContext': 'DRV.PERF.EQUIPMENT_FAILURE.VEHICLECONTEXT',
  'EQUIPMENT_FAILURE:defectReported': 'DRV.PERF.EQUIPMENT_FAILURE.DEFECTREPORTED',
  'EQUIPMENT_FAILURE:reportedDate': 'DRV.PERF.EQUIPMENT_FAILURE.REPORTEDDATE',
  'EQUIPMENT_FAILURE:equipmentNarrative': 'DRV.PERF.EQUIPMENT_FAILURE.EQUIPMENTNARRATIVE',
  'SAFETY_OBSERVATION:observationType': 'DRV.PERF.SAFETY_OBSERVATION.OBSERVATIONTYPE',
  'SAFETY_OBSERVATION:observationState': 'DRV.PERF.SAFETY_OBSERVATION.OBSERVATIONSTATE',
  'SAFETY_OBSERVATION:observer': 'DRV.PERF.SAFETY_OBSERVATION.OBSERVER',
  'SAFETY_OBSERVATION:observationNarrative': 'DRV.PERF.SAFETY_OBSERVATION.OBSERVATIONNARRATIVE',
  'CUSTOMER_COMPLIMENT:customerName': 'DRV.PERF.CUSTOMER_COMPLIMENT.CUSTOMERNAME',
  'CUSTOMER_COMPLIMENT:recognizedBy': 'DRV.PERF.CUSTOMER_COMPLIMENT.RECOGNIZEDBY',
  'CUSTOMER_COMPLIMENT:complimentDate': 'DRV.PERF.CUSTOMER_COMPLIMENT.COMPLIMENTDATE',
  'CUSTOMER_COMPLIMENT:complimentNarrative': 'DRV.PERF.CUSTOMER_COMPLIMENT.COMPLIMENTNARRATIVE',
  'TELEMATICS_CAMERA_OBSERVATION:provider': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.PROVIDER',
  'TELEMATICS_CAMERA_OBSERVATION:observationType': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.OBSERVATIONTYPE',
  'TELEMATICS_CAMERA_OBSERVATION:rawValue': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.RAWVALUE',
  'TELEMATICS_CAMERA_OBSERVATION:thresholdValue': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.THRESHOLDVALUE',
  'TELEMATICS_CAMERA_OBSERVATION:thresholdSource': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.THRESHOLDSOURCE',
  'TELEMATICS_CAMERA_OBSERVATION:thresholdId': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.THRESHOLDID',
  'TELEMATICS_CAMERA_OBSERVATION:thresholdVersion': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.THRESHOLDVERSION',
  'TELEMATICS_CAMERA_OBSERVATION:thresholdEffectiveDate': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.THRESHOLDEFFECTIVEDATE',
  'TELEMATICS_CAMERA_OBSERVATION:variance': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.VARIANCE',
  'TELEMATICS_CAMERA_OBSERVATION:durationSeconds': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.DURATIONSECONDS',
  'TELEMATICS_CAMERA_OBSERVATION:peakValue': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.PEAKVALUE',
  'TELEMATICS_CAMERA_OBSERVATION:averageValue': 'DRV.PERF.TELEMATICS_CAMERA_OBSERVATION.AVERAGEVALUE',
  'SECURITY_EVENT:securityType': 'DRV.PERF.SECURITY_EVENT.SECURITYTYPE',
  'SECURITY_EVENT:accessCompromised': 'DRV.PERF.SECURITY_EVENT.ACCESSCOMPROMISED',
  'SECURITY_EVENT:eventNarrative': 'DRV.PERF.SECURITY_EVENT.EVENTNARRATIVE',
  'EMERGENCY_EVENT:emergencyType': 'DRV.PERF.EMERGENCY_EVENT.EMERGENCYTYPE',
  'EMERGENCY_EVENT:emergencyServices': 'DRV.PERF.EMERGENCY_EVENT.EMERGENCYSERVICES',
  'EMERGENCY_EVENT:downtimeHours': 'DRV.PERF.EMERGENCY_EVENT.DOWNTIMEHOURS',
  'EMERGENCY_EVENT:emergencyNarrative': 'DRV.PERF.EMERGENCY_EVENT.EMERGENCYNARRATIVE',
  'SPEEDING:thresholdBasis': 'DRV.PERF.SPEEDING.THRESHOLDBASIS',
  'SPEEDING:actualSpeed': 'DRV.PERF.SPEEDING.ACTUALSPEED',
  'SPEEDING:postedSpeedLimit': 'DRV.PERF.SPEEDING.POSTEDSPEEDLIMIT',
  'SPEEDING:companyThreshold': 'DRV.PERF.SPEEDING.COMPANYTHRESHOLD',
  'SPEEDING:applicableThreshold': 'DRV.PERF.SPEEDING.APPLICABLETHRESHOLD',
  'SPEEDING:amountExceeded': 'DRV.PERF.SPEEDING.AMOUNTEXCEEDED',
  'SPEEDING:durationSeconds': 'DRV.PERF.SPEEDING.DURATIONSECONDS',
  'SPEEDING:distanceTraveled': 'DRV.PERF.SPEEDING.DISTANCETRAVELED',
  'SPEEDING:peakSpeed': 'DRV.PERF.SPEEDING.PEAKSPEED',
  'SPEEDING:averageSpeed': 'DRV.PERF.SPEEDING.AVERAGESPEED',
  'SPEEDING:zoneType': 'DRV.PERF.SHARED.ZONE_TYPE',
  'SPEEDING:loadStatus': 'DRV.PERF.SHARED.LOAD_STATE',
  'SPEEDING:provider': 'DRV.PERF.SPEEDING.PROVIDER',
  'SPEEDING:thresholdVersion': 'DRV.PERF.SPEEDING.THRESHOLDVERSION',
  'SPEEDING:thresholdEffectiveDate': 'DRV.PERF.SPEEDING.THRESHOLDEFFECTIVEDATE',
  'HARSH_BRAKING:triggerDeceleration': 'DRV.PERF.HARSH_BRAKING.TRIGGERDECELERATION',
  'HARSH_BRAKING:threshold': 'DRV.PERF.HARSH_BRAKING.THRESHOLD',
  'HARSH_BRAKING:thresholdVariance': 'DRV.PERF.HARSH_BRAKING.THRESHOLDVARIANCE',
  'HARSH_BRAKING:durationSeconds': 'DRV.PERF.HARSH_BRAKING.DURATIONSECONDS',
  'HARSH_BRAKING:distanceTraveled': 'DRV.PERF.HARSH_BRAKING.DISTANCETRAVELED',
  'HARSH_BRAKING:peakDeceleration': 'DRV.PERF.HARSH_BRAKING.PEAKDECELERATION',
  'HARSH_BRAKING:averageDeceleration': 'DRV.PERF.HARSH_BRAKING.AVERAGEDECELERATION',
  'HARSH_BRAKING:speedAtTrigger': 'DRV.PERF.HARSH_BRAKING.SPEEDATTRIGGER',
  'HARSH_BRAKING:endingSpeed': 'DRV.PERF.HARSH_BRAKING.ENDINGSPEED',
  'HARSH_BRAKING:distanceMeters': 'DRV.PERF.HARSH_BRAKING.DISTANCEMETERS',
  'HARSH_BRAKING:roadGrade': 'DRV.PERF.HARSH_BRAKING.ROADGRADE',
  'HARSH_BRAKING:weather': 'DRV.PERF.SHARED.WEATHER_CONDITION',
  'HARSH_BRAKING:roadSurface': 'DRV.PERF.SHARED.ROAD_SURFACE',
  'HARSH_BRAKING:lighting': 'DRV.PERF.SHARED.LIGHTING_CONDITION',
  'HARSH_BRAKING:traffic': 'DRV.PERF.SHARED.TRAFFIC_CONDITION',
  'HARSH_BRAKING:loadStatus': 'DRV.PERF.SHARED.LOAD_STATE',
  'HARSH_BRAKING:forwardCollisionWarning': 'DRV.PERF.HARSH_BRAKING.FORWARDCOLLISIONWARNING',
  'HARSH_BRAKING:provider': 'DRV.PERF.HARSH_BRAKING.PROVIDER',
  'HARSH_BRAKING:thresholdVersion': 'DRV.PERF.HARSH_BRAKING.THRESHOLDVERSION',
  'HARSH_ACCELERATION:triggerAcceleration': 'DRV.PERF.HARSH_ACCELERATION.TRIGGERACCELERATION',
  'HARSH_ACCELERATION:threshold': 'DRV.PERF.HARSH_ACCELERATION.THRESHOLD',
  'HARSH_ACCELERATION:variance': 'DRV.PERF.HARSH_ACCELERATION.VARIANCE',
  'HARSH_ACCELERATION:durationSeconds': 'DRV.PERF.HARSH_ACCELERATION.DURATIONSECONDS',
  'HARSH_ACCELERATION:distanceTraveled': 'DRV.PERF.HARSH_ACCELERATION.DISTANCETRAVELED',
  'HARSH_ACCELERATION:peakAcceleration': 'DRV.PERF.HARSH_ACCELERATION.PEAKACCELERATION',
  'HARSH_ACCELERATION:averageAcceleration': 'DRV.PERF.HARSH_ACCELERATION.AVERAGEACCELERATION',
  'HARSH_ACCELERATION:triggerSpeed': 'DRV.PERF.HARSH_ACCELERATION.TRIGGERSPEED',
  'HARSH_ACCELERATION:endingSpeed': 'DRV.PERF.HARSH_ACCELERATION.ENDINGSPEED',
  'HARSH_ACCELERATION:distanceMeters': 'DRV.PERF.HARSH_ACCELERATION.DISTANCEMETERS',
  'HARSH_ACCELERATION:loadStatus': 'DRV.PERF.SHARED.LOAD_STATE',
  'HARSH_ACCELERATION:weather': 'DRV.PERF.SHARED.WEATHER_CONDITION',
  'HARSH_ACCELERATION:road': 'DRV.PERF.SHARED.ROAD_SURFACE',
  'HARSH_ACCELERATION:lighting': 'DRV.PERF.SHARED.LIGHTING_CONDITION',
  'HARSH_CORNERING:lateralAcceleration': 'DRV.PERF.HARSH_CORNERING.LATERALACCELERATION',
  'HARSH_CORNERING:threshold': 'DRV.PERF.HARSH_CORNERING.THRESHOLD',
  'HARSH_CORNERING:variance': 'DRV.PERF.HARSH_CORNERING.VARIANCE',
  'HARSH_CORNERING:durationSeconds': 'DRV.PERF.HARSH_CORNERING.DURATIONSECONDS',
  'HARSH_CORNERING:distanceTraveled': 'DRV.PERF.HARSH_CORNERING.DISTANCETRAVELED',
  'HARSH_CORNERING:peakLateralAcceleration': 'DRV.PERF.HARSH_CORNERING.PEAKLATERALACCELERATION',
  'HARSH_CORNERING:averageLateralAcceleration': 'DRV.PERF.HARSH_CORNERING.AVERAGELATERALACCELERATION',
  'HARSH_CORNERING:speed': 'DRV.PERF.HARSH_CORNERING.SPEED',
  'HARSH_CORNERING:turnRadius': 'DRV.PERF.HARSH_CORNERING.TURNRADIUS',
  'HARSH_CORNERING:loadStatus': 'DRV.PERF.SHARED.LOAD_STATE',
  'HARSH_CORNERING:roadGeometry': 'DRV.PERF.HARSH_CORNERING.ROADGEOMETRY',
  'HARSH_CORNERING:weather': 'DRV.PERF.SHARED.WEATHER_CONDITION',
  'HARSH_CORNERING:roadSurface': 'DRV.PERF.SHARED.ROAD_SURFACE',
  'FOLLOWING_DISTANCE:timeGapSeconds': 'DRV.PERF.FOLLOWING_DISTANCE.TIMEGAPSECONDS',
  'FOLLOWING_DISTANCE:timeGapThresholdSeconds': 'DRV.PERF.FOLLOWING_DISTANCE.TIMEGAPTHRESHOLDSECONDS',
  'FOLLOWING_DISTANCE:timeGapVarianceSeconds': 'DRV.PERF.FOLLOWING_DISTANCE.TIMEGAPVARIANCESECONDS',
  'FOLLOWING_DISTANCE:distanceGapMeters': 'DRV.PERF.FOLLOWING_DISTANCE.DISTANCEGAPMETERS',
  'FOLLOWING_DISTANCE:distanceThresholdMeters': 'DRV.PERF.FOLLOWING_DISTANCE.DISTANCETHRESHOLDMETERS',
  'FOLLOWING_DISTANCE:distanceVarianceMeters': 'DRV.PERF.FOLLOWING_DISTANCE.DISTANCEVARIANCEMETERS',
  'FOLLOWING_DISTANCE:durationSeconds': 'DRV.PERF.FOLLOWING_DISTANCE.DURATIONSECONDS',
  'FOLLOWING_DISTANCE:minimumTimeGapSeconds': 'DRV.PERF.FOLLOWING_DISTANCE.MINIMUMTIMEGAPSECONDS',
  'FOLLOWING_DISTANCE:minimumDistanceGapMeters': 'DRV.PERF.FOLLOWING_DISTANCE.MINIMUMDISTANCEGAPMETERS',
  'FOLLOWING_DISTANCE:driverVehicleSpeed': 'DRV.PERF.FOLLOWING_DISTANCE.DRIVERVEHICLESPEED',
  'FOLLOWING_DISTANCE:leadVehicleSpeed': 'DRV.PERF.FOLLOWING_DISTANCE.LEADVEHICLESPEED',
  'FOLLOWING_DISTANCE:relativeSpeed': 'DRV.PERF.FOLLOWING_DISTANCE.RELATIVESPEED',
  'FOLLOWING_DISTANCE:distanceTraveledMeters': 'DRV.PERF.FOLLOWING_DISTANCE.DISTANCETRAVELEDMETERS',
  'FOLLOWING_DISTANCE:loadStatus': 'DRV.PERF.SHARED.LOAD_STATE',
  'FATIGUE_INDICATOR:indicatorType': 'DRV.PERF.FATIGUE_INDICATOR.INDICATORTYPE',
  'FATIGUE_INDICATOR:eyeClosureDurationMs': 'DRV.PERF.FATIGUE_INDICATOR.EYECLOSUREDURATIONMS',
  'FATIGUE_INDICATOR:perclosPercent': 'DRV.PERF.FATIGUE_INDICATOR.PERCLOSPERCENT',
  'FATIGUE_INDICATOR:hoursDriven': 'DRV.PERF.FATIGUE_INDICATOR.HOURSDRIVEN',
  'FATIGUE_INDICATOR:timeSinceBreakMinutes': 'DRV.PERF.FATIGUE_INDICATOR.TIMESINCEBREAKMINUTES',
  'FATIGUE_INDICATOR:consecutiveDrivingDays': 'DRV.PERF.FATIGUE_INDICATOR.CONSECUTIVEDRIVINGDAYS',
  'FATIGUE_INDICATOR:dutyContext': 'DRV.PERF.SHARED.DUTY_CONTEXT',
  'FATIGUE_INDICATOR:hosProximity': 'DRV.PERF.FATIGUE_INDICATOR.HOSPROXIMITY',
  'FATIGUE_INDICATOR:sourceClassification': 'DRV.PERF.FATIGUE_INDICATOR.SOURCECLASSIFICATION',
  'FATIGUE_INDICATOR:indicatorNotes': 'DRV.PERF.FATIGUE_INDICATOR.INDICATORNOTES',
  'DEVICE_DATA_INTEGRITY:integrityState': 'DRV.PERF.DEVICE_DATA_INTEGRITY.INTEGRITYSTATE',
  'DEVICE_DATA_INTEGRITY:deviceType': 'DRV.PERF.DEVICE_DATA_INTEGRITY.DEVICETYPE',
  'DEVICE_DATA_INTEGRITY:anomalyType': 'DRV.PERF.DEVICE_DATA_INTEGRITY.ANOMALYTYPE',
  'DEVICE_DATA_INTEGRITY:interferenceMethod': 'DRV.PERF.DEVICE_DATA_INTEGRITY.INTERFERENCEMETHOD',
  'DEVICE_DATA_INTEGRITY:dataImpact': 'DRV.PERF.DEVICE_DATA_INTEGRITY.DATAIMPACT',
  'DEVICE_DATA_INTEGRITY:detectionDate': 'DRV.PERF.DEVICE_DATA_INTEGRITY.DETECTIONDATE',
  'DEVICE_DATA_INTEGRITY:detectionTime': 'DRV.PERF.DEVICE_DATA_INTEGRITY.DETECTIONTIME',
  'DEVICE_DATA_INTEGRITY:deviceDisabled': 'DRV.PERF.DEVICE_DATA_INTEGRITY.DEVICEDISABLED',
  'DEVICE_DATA_INTEGRITY:dataLossDurationMinutes': 'DRV.PERF.DEVICE_DATA_INTEGRITY.DATALOSSDURATIONMINUTES',
  'DEVICE_DATA_INTEGRITY:dataRecoveryState': 'DRV.PERF.DEVICE_DATA_INTEGRITY.DATARECOVERYSTATE',
  'DEVICE_DATA_INTEGRITY:sourceRecordId': 'DRV.PERF.DEVICE_DATA_INTEGRITY.SOURCERECORDID',
  'TRIP_SERVICE_PERFORMANCE:serviceType': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.SERVICETYPE',
  'TRIP_SERVICE_PERFORMANCE:scheduledDate': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.SCHEDULEDDATE',
  'TRIP_SERVICE_PERFORMANCE:scheduledTime': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.SCHEDULEDTIME',
  'TRIP_SERVICE_PERFORMANCE:actualDate': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.ACTUALDATE',
  'TRIP_SERVICE_PERFORMANCE:actualTime': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.ACTUALTIME',
  'TRIP_SERVICE_PERFORMANCE:calculatedVarianceMinutes': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.CALCULATEDVARIANCEMINUTES',
  'TRIP_SERVICE_PERFORMANCE:serviceMetric': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.SERVICEMETRIC',
  'TRIP_SERVICE_PERFORMANCE:metricValue': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.METRICVALUE',
  'TRIP_SERVICE_PERFORMANCE:metricThreshold': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.METRICTHRESHOLD',
  'TRIP_SERVICE_PERFORMANCE:notificationState': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.NOTIFICATIONSTATE',
  'TRIP_SERVICE_PERFORMANCE:acknowledgementState': 'DRV.PERF.TRIP_SERVICE_PERFORMANCE.ACKNOWLEDGEMENTSTATE',
  'LANE_DEPARTURE:durationSeconds': 'DRV.PERF.LANE_DEPARTURE.DURATIONSECONDS',
  'LANE_DEPARTURE:lateralDeviationMeters': 'DRV.PERF.LANE_DEPARTURE.LATERALDEVIATIONMETERS',
  'LANE_DEPARTURE:speed': 'DRV.PERF.LANE_DEPARTURE.SPEED',
  'LANE_DEPARTURE:laneType': 'DRV.PERF.LANE_DEPARTURE.LANETYPE',
  'LANE_DEPARTURE:roadType': 'DRV.PERF.LANE_DEPARTURE.ROADTYPE',
  'LANE_DEPARTURE:weather': 'DRV.PERF.SHARED.WEATHER_CONDITION',
  'SEATBELT:seatbeltState': 'DRV.PERF.SEATBELT.SEATBELTSTATE',
  'SEATBELT:durationSeconds': 'DRV.PERF.SEATBELT.DURATIONSECONDS',
  'SEATBELT:speed': 'DRV.PERF.SEATBELT.SPEED',
  'SEATBELT:provider': 'DRV.PERF.SEATBELT.PROVIDER',
  'DISTRACTED_DRIVING:distractionType': 'DRV.PERF.DISTRACTED_DRIVING.DISTRACTIONTYPE',
  'DISTRACTED_DRIVING:durationSeconds': 'DRV.PERF.DISTRACTED_DRIVING.DURATIONSECONDS',
  'DISTRACTED_DRIVING:speed': 'DRV.PERF.DISTRACTED_DRIVING.SPEED',
  'DISTRACTED_DRIVING:observedContext': 'DRV.PERF.DISTRACTED_DRIVING.OBSERVEDCONTEXT',
  'IDLE_TIME:durationMinutes': 'DRV.PERF.IDLE_TIME.DURATIONMINUTES',
  'IDLE_TIME:thresholdMinutes': 'DRV.PERF.IDLE_TIME.THRESHOLDMINUTES',
  'IDLE_TIME:varianceMinutes': 'DRV.PERF.IDLE_TIME.VARIANCEMINUTES',
  'IDLE_TIME:locationType': 'DRV.PERF.IDLE_TIME.LOCATIONTYPE',
  'IDLE_TIME:loadStatus': 'DRV.PERF.SHARED.LOAD_STATE',
  'ROUTE_DEVIATION:deviationDistanceMiles': 'DRV.PERF.ROUTE_DEVIATION.DEVIATIONDISTANCEMILES',
  'ROUTE_DEVIATION:deviationDurationMinutes': 'DRV.PERF.ROUTE_DEVIATION.DEVIATIONDURATIONMINUTES',
  'ROUTE_DEVIATION:deviationReason': 'DRV.PERF.ROUTE_DEVIATION.DEVIATIONREASON',
  'BACKING:maneuverType': 'DRV.PERF.BACKING.MANEUVERTYPE',
  'BACKING:spotterUsed': 'DRV.PERF.BACKING.SPOTTERUSED',
  'BACKING:contactOccurred': 'DRV.PERF.BACKING.CONTACTOCCURRED',
  'BACKING:objectContacted': 'DRV.PERF.BACKING.OBJECTCONTACTED',
  'BACKING:siteType': 'DRV.PERF.BACKING.SITETYPE',
  'STOP_SIGN_RED_LIGHT:controlType': 'DRV.PERF.STOP_SIGN_RED_LIGHT.CONTROLTYPE',
  'STOP_SIGN_RED_LIGHT:observedOutcome': 'DRV.PERF.STOP_SIGN_RED_LIGHT.OBSERVEDOUTCOME',
  'STOP_SIGN_RED_LIGHT:speedAtControl': 'DRV.PERF.STOP_SIGN_RED_LIGHT.SPEEDATCONTROL',
  'RAILROAD_CROSSING:crossingType': 'DRV.PERF.RAILROAD_CROSSING.CROSSINGTYPE',
  'RAILROAD_CROSSING:observedAction': 'DRV.PERF.RAILROAD_CROSSING.OBSERVEDACTION',
  'RAILROAD_CROSSING:trainPresent': 'DRV.PERF.RAILROAD_CROSSING.TRAINPRESENT',
  'RAILROAD_CROSSING:gatesDown': 'DRV.PERF.RAILROAD_CROSSING.GATESDOWN',
  'CUSTOMER_SITE_BEHAVIOR:behaviorType': 'DRV.PERF.CUSTOMER_SITE_BEHAVIOR.BEHAVIORTYPE',
  'CUSTOMER_SITE_BEHAVIOR:behaviorNarrative': 'DRV.PERF.CUSTOMER_SITE_BEHAVIOR.BEHAVIORNARRATIVE',
  'PPE_SAFETY_PROTOCOL:protocolType': 'DRV.PERF.PPE_SAFETY_PROTOCOL.PROTOCOLTYPE',
  'PPE_SAFETY_PROTOCOL:observedState': 'DRV.PERF.PPE_SAFETY_PROTOCOL.OBSERVEDSTATE',
  'PPE_SAFETY_PROTOCOL:requirementSource': 'DRV.PERF.PPE_SAFETY_PROTOCOL.REQUIREMENTSOURCE',
  'PPE_SAFETY_PROTOCOL:observationNarrative': 'DRV.PERF.PPE_SAFETY_PROTOCOL.OBSERVATIONNARRATIVE',
};

const CATEGORY_SOURCE_POLICY_FAMILY: Readonly<Partial<Record<EventType, PerformanceSourcePolicy>>> = {
  "Collision": SOURCE_POLICY_FAMILIES.COLLISION_INCIDENT,
  "Near Miss": SOURCE_POLICY_FAMILIES.COLLISION_INCIDENT,
  "Roadside Inspection": SOURCE_POLICY_FAMILIES.ROADSIDE_INSPECTION,
  "Out-of-Service Order": SOURCE_POLICY_FAMILIES.OOS,
  "Cargo Damage": SOURCE_POLICY_FAMILIES.CARGO,
  "Cargo Theft": SOURCE_POLICY_FAMILIES.SECURITY,
  "Spill or Release": SOURCE_POLICY_FAMILIES.EMERGENCY,
  "Customer Complaint": SOURCE_POLICY_FAMILIES.CUSTOMER,
  "Customer Commendation": SOURCE_POLICY_FAMILIES.CUSTOMER,
  "Injury": SOURCE_POLICY_FAMILIES.COLLISION_INCIDENT,
  "Security Incident": SOURCE_POLICY_FAMILIES.SECURITY,
  "Warning": SOURCE_POLICY_FAMILIES.REGULATORY_DOCUMENT,
  "Violation": SOURCE_POLICY_FAMILIES.REGULATORY_DOCUMENT,
  "Equipment Failure / Critical Defect": SOURCE_POLICY_FAMILIES.EQUIPMENT_MAINTENANCE,
  "Safety Observation": SOURCE_POLICY_FAMILIES.OBSERVATION,
  "Emergency Event": SOURCE_POLICY_FAMILIES.EMERGENCY,
  "Speeding": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Harsh Braking": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Harsh Acceleration": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Harsh Cornering": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Following Distance": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Fatigue Indicator": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Device / Data Integrity": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Trip Completion / Service Performance": SOURCE_POLICY_FAMILIES.SERVICE_TRIP,
  "Lane Departure": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Seatbelt": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Distracted Driving": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Idle Time": SOURCE_POLICY_FAMILIES.TELEMATICS,
  "Route Deviation": SOURCE_POLICY_FAMILIES.SERVICE_TRIP,
  "Backing": SOURCE_POLICY_FAMILIES.OBSERVATION,
  "Stop Sign / Red Light": SOURCE_POLICY_FAMILIES.REGULATORY_DOCUMENT,
  "Railroad Crossing": SOURCE_POLICY_FAMILIES.OBSERVATION,
  "Customer-Site Behavior": SOURCE_POLICY_FAMILIES.CUSTOMER,
  "PPE / Safety Protocol": SOURCE_POLICY_FAMILIES.OBSERVATION,
};

export const DRIVER_PERFORMANCE_CATEGORY_REGISTRY: readonly PerformanceCategoryDefinition[] = DRIVER_PERFORMANCE_CATEGORY_REGISTRY_RAW.map((definition) => {
  const basePolicy = definition.policy || (definition.evidenceRequired ? DOCUMENT_POLICY : MANUAL_POLICY);
  const sourcePolicy = CATEGORY_SOURCE_POLICY_FAMILY[definition.value];
  return {
    ...definition,
    policy: sourcePolicy ? { ...basePolicy, sourcePolicy } : basePolicy,
    relationships: definition.relationships || REPRESENTATIVE_RELATIONSHIPS[definition.value],
    fields: definition.fields.map((field) => ({
      ...field,
      dataPointId: EXPLICIT_CATEGORY_DATA_POINT_IDS[`${definition.code}:${field.key}`] || field.dataPointId,
    })),
  };
});

export function resolvePerformanceSourcePolicy(definition: PerformanceCategoryDefinition): PerformanceSourcePolicy {
  return definition.policy?.sourcePolicy || {
    allowedOrigins: SOURCE_ORIGINS.map((item) => item.value),
    defaultOrigin: "MANUAL_ENTRY",
    authoritativeSourceTypes: definition.sources.map((source) => ({ value: source, label: source })),
    reporterApplicability: REPORTER_OPTIONS,
  };
}

const INTENTIONAL_SHARED_DATA_POINT_IDS = new Set<string>([
  "DRV.PERF.SHARED.WEATHER_CONDITION",
  "DRV.PERF.SHARED.ROAD_SURFACE",
  "DRV.PERF.SHARED.LIGHTING_CONDITION",
  "DRV.PERF.SHARED.ZONE_TYPE",
  "DRV.PERF.SHARED.LOAD_STATE",
  "DRV.PERF.SHARED.TRAFFIC_CONDITION",
  "DRV.PERF.SHARED.DUTY_CONTEXT",
  "DRV.PERF.SOURCETYPE",
  "DRV.PERF.SOURCERECORDID",
]);

/**
 * Development-time registry integrity invariant.
 *
 * The field helper intentionally requires every schema field to resolve to an
 * explicit Data Point ID. This validator is a second, registry-level guard:
 * it inspects the fully constructed category registry and aggregates all
 * integrity defects before throwing, rather than failing on the first one.
 */
function validatePerformanceDataPointRegistry(
  registry: readonly PerformanceCategoryDefinition[],
): void {
  if (process.env.NODE_ENV === "production") return;

  const problems: string[] = [];
  const categoryMappingKeys = new Set<string>();
  const dataPointLocations = new Map<string, string[]>();

  for (const category of registry) {
    const seenFieldKeys = new Set<string>();

    for (const field of category.fields) {
      const location = `${category.code}.${field.key}`;
      const mappingKey = `${category.code}:${field.key}`;
      categoryMappingKeys.add(mappingKey);

      if (!field.dataPointId?.trim()) {
        problems.push(`Missing Data Point ID: ${location}`);
      }

      if (seenFieldKeys.has(field.key)) {
        problems.push(`Duplicate field key within category: ${location}`);
      } else {
        seenFieldKeys.add(field.key);
      }

      if (field.dataPointId?.trim()) {
        const locations = dataPointLocations.get(field.dataPointId) || [];
        locations.push(location);
        dataPointLocations.set(field.dataPointId, locations);
      }
    }
  }

  for (const [dataPointId, locations] of dataPointLocations) {
    if (locations.length > 1 && !INTENTIONAL_SHARED_DATA_POINT_IDS.has(dataPointId)) {
      problems.push(
        `Conflicting duplicate Data Point ID ${dataPointId}: ${locations.join(", ")}`,
      );
    }
  }

  for (const mappingKey of Object.keys(EXPLICIT_CATEGORY_DATA_POINT_IDS)) {
    if (!categoryMappingKeys.has(mappingKey)) {
      problems.push(`Orphan category Data Point mapping: ${mappingKey}`);
    }
  }

  if (problems.length) {
    const message = [
      "Performance Data Point registry integrity validation failed:",
      ...problems.map((problem) => `- ${problem}`),
    ].join("\n");
    console.error(message);
    throw new Error(message);
  }
}

validatePerformanceDataPointRegistry(DRIVER_PERFORMANCE_CATEGORY_REGISTRY);

export const DRIVER_PERFORMANCE_CATEGORY_BY_VALUE: Readonly<Record<EventType, PerformanceCategoryDefinition>> = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.reduce((map, definition) => {
  map[definition.value] = definition;
  return map;
}, {} as Record<EventType, PerformanceCategoryDefinition>);

export const RECORDABLE_PERFORMANCE_CATEGORIES: readonly EventType[] = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.filter((definition) => PERFORMANCE_CATEGORY_OWNERSHIP[definition.value] === "RECORDABLE_EVENT").map((definition) => definition.value);

export const DRIVER_PERFORMANCE_LEGACY_CATEGORY_ALIASES: Readonly<Record<string, EventType>> = {
  "Positive Safety Observation": "Safety Observation",
  "Customer Compliment": "Customer Commendation",
  "Equipment-related Event": "Equipment Failure / Critical Defect",
  "Security Event": "Security Incident",
  "Telematics / Camera Observation": "Device / Data Integrity",
};

export const PERFORMANCE_VERIFICATION_STATES = ["Unverified", "Partially Verified", "Verified", "Unable to Verify"] as const;
export const PERFORMANCE_DISPUTE_STATES = ["Not Disputed", "Disputed", "Resolved"] as const;
export const PERFORMANCE_SEMANTIC_UNKNOWN: SemanticState = "Unknown";


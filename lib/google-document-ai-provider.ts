import { classifyRoadsideForRouting, type MachineAcquisitionProvider, type MachineAcquisitionRequest, type MachineObservation, type MachineSourceLocation, type TESMachineDocumentResult } from "@/lib/machine-acquisition";

interface GoogleTextSegment { startIndex?: string; endIndex?: string }
interface GoogleTextAnchor { content?: string; textSegments?: GoogleTextSegment[] }
interface GoogleVertex { x?: number; y?: number }
interface GoogleBoundingPoly { normalizedVertices?: GoogleVertex[]; vertices?: GoogleVertex[] }
interface GooglePageRef { page?: string; boundingPoly?: GoogleBoundingPoly }
interface GooglePageAnchor { pageRefs?: GooglePageRef[] }
interface GoogleNormalizedValue { text?: string; booleanValue?: boolean; integerValue?: number | string; floatValue?: number }
interface GoogleEntity {
  id?: string; type?: string; mentionText?: string; confidence?: number;
  method?: "METHOD_UNSPECIFIED" | "EXTRACT" | "DERIVE" | "RELAXED_EXTRACT";
  textAnchor?: GoogleTextAnchor; pageAnchor?: GooglePageAnchor;
  normalizedValue?: GoogleNormalizedValue; properties?: GoogleEntity[];
}
interface GoogleDocument { entities?: GoogleEntity[] }
interface GoogleProcessDocumentResponse { document?: GoogleDocument }
export interface GoogleDocumentAIProviderConfig {
  projectId: string; location: string; processorId: string; processorVersion?: string; accessToken: string;
}
const SOURCE_FIELD_MAP: Readonly<Record<string,string>> = {
 source_document_title:"roadside.source_document_title", report_number:"roadside.report_number",
 inspection_date:"roadside.inspection_date", inspection_time:"roadside.inspection_time",
 inspection_end_date:"roadside.inspection_end_date", inspection_end_time:"roadside.inspection_end_time",
 inspection_level:"roadside.inspection_level", source_status:"roadside.source_status",
 inspection_type:"roadside.inspection_type", location:"roadside.location", city:"roadside.city",
 state_province:"roadside.state_province", country:"roadside.country", odometer_reading:"roadside.odometer_reading",
 vehicle_use:"roadside.vehicle_use", dangerous_goods:"roadside.dangerous_goods", number_of_axles:"roadside.number_of_axles",
 registered_weight:"roadside.registered_weight", carrier_name:"roadside.carrier_name", carrier_address:"roadside.carrier_address",
 carrier_city:"roadside.carrier_city", carrier_state_province:"roadside.carrier_state_province",
 carrier_postal_code:"roadside.carrier_postal_code", carrier_nsc_number:"roadside.carrier_nsc_number",
 carrier_pic_number:"roadside.carrier_pic_number", driver_name:"roadside.driver_name",
 driver_licence_number:"roadside.driver_licence_number", driver_licence_jurisdiction:"roadside.driver_licence_jurisdiction",
 driver_date_of_birth:"roadside.driver_date_of_birth", officer_name:"roadside.officer_name",
 officer_number:"roadside.officer_number", agency:"roadside.agency", officer_location:"roadside.officer_location",
 source_unit_number:"roadside.equipment.source_unit_number", equipment_type:"roadside.equipment.equipment_type",
 vin_serial_number:"roadside.equipment.vin_serial_number", plate_number:"roadside.equipment.plate_number",
 plate_jurisdiction:"roadside.equipment.plate_jurisdiction", cvsa_decal_number:"roadside.equipment.cvsa_decal_number",
 cvip_pmvi_decal_number:"roadside.equipment.cvip_pmvi_decal_number",
 cvip_pmvi_decal_jurisdiction:"roadside.equipment.cvip_pmvi_decal_jurisdiction",
 source_equipment_reference:"roadside.finding.source_equipment_reference", defect_category:"roadside.finding.defect_category",
 defect_code:"roadside.finding.defect_code", defect_description:"roadside.finding.defect_description",
 out_of_service:"roadside.finding.out_of_service", major_defect:"roadside.finding.major_defect",
 charges:"roadside.finding.charges", comments:"roadside.finding.comments", source_points:"roadside.finding.source_points",
 inspection_state_province:"roadside.inspection_state_province", enforcement_agency:"roadside.enforcement_agency",
 enforcement_disposition:"roadside.enforcement_disposition", cvsa_result:"roadside.cvsa_result",
 inspection_location:"roadside.inspection_location", inspection_city:"roadside.inspection_city",
 inspection_notes:"roadside.inspection_notes", inspection_start_datetime:"roadside.inspection_start_datetime",
 inspection_end_datetime:"roadside.inspection_end_datetime", oos_sticker_applied:"roadside.oos_sticker_applied",
 repair_status:"roadside.repair_status", source_code_legend:"roadside.source_code_legend",
 inspection_item:"roadside.finding.inspection_item", source_finding_number:"roadside.finding.source_finding_number",
 source_reference_number:"roadside.finding.source_reference_number", source_result_code:"roadside.finding.source_result_code",
 violation_code:"roadside.finding.violation_code", violation_description:"roadside.finding.violation_description"
};
const leafType=(type:string)=>{const p=type.split("/").filter(Boolean);return p[p.length-1]||type};
function sourceLocation(e:GoogleEntity):MachineSourceLocation|undefined {
 const r=e.pageAnchor?.pageRefs?.[0], s=e.textAnchor?.textSegments?.[0], v=r?.boundingPoly?.normalizedVertices||r?.boundingPoly?.vertices;
 if(!r&&!s&&!v?.length)return undefined;
 return {page:r?.page!==undefined?Number(r.page)+1:undefined,textAnchorStart:s?.startIndex!==undefined?Number(s.startIndex):undefined,textAnchorEnd:s?.endIndex!==undefined?Number(s.endIndex):undefined,boundingPolygon:v?.map(x=>({x:x.x,y:x.y}))};
}
function rawValue(e:GoogleEntity):string|number|boolean|null {
 const m=e.mentionText??e.textAnchor?.content;if(m!==undefined&&m!=="")return m;
 const n=e.normalizedValue;if(n?.booleanValue!==undefined)return n.booleanValue;if(n?.integerValue!==undefined)return Number(n.integerValue);if(n?.floatValue!==undefined)return n.floatValue;return n?.text??null;
}
function normalizedValue(e:GoogleEntity):string|number|boolean|null|undefined {
 const n=e.normalizedValue;if(!n)return undefined;if(n.booleanValue!==undefined)return n.booleanValue;if(n.integerValue!==undefined)return Number(n.integerValue);if(n.floatValue!==undefined)return n.floatValue;return n.text;
}
function method(e:GoogleEntity):MachineObservation["method"] { return !e.method||e.method==="METHOD_UNSPECIFIED"?"EXTRACT":e.method }
function flattenEntity(e:GoogleEntity,parentType?:string,parentEntityId?:string):MachineObservation[] {
 const full=e.type||"", leaf=leafType(full), parent=parentType?leafType(parentType):"";
 const isFinding=parent==="finding"||full.startsWith("finding/"), isEquipment=parent==="equipment"||full.startsWith("equipment/");
 let id=SOURCE_FIELD_MAP[leaf]; if(leaf==="source_unit_number"&&isFinding)id="roadside.finding.source_unit_number"; if(leaf==="source_unit_number"&&isEquipment)id="roadside.equipment.source_unit_number";
 const out:MachineObservation[]=[]; if(id)out.push({dataPointId:id,rawValue:rawValue(e),normalizedValue:normalizedValue(e),confidence:e.confidence,sourceLocation:sourceLocation(e),providerEntityId:parentEntityId||e.id,method:method(e)});
 const groupingId=e.id||parentEntityId; for(const child of e.properties||[])out.push(...flattenEntity(child,full,groupingId)); return out;
}
function findRoadsideClassification(entities:GoogleEntity[]):{confidence?:number;title?:string}{
 const candidates=entities.filter(e=>`${e.type||""} ${e.mentionText||""} ${e.normalizedValue?.text||""}`.toLowerCase().match(/roadside|commercial vehicle inspection|cvsa/));
 const best=candidates.sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0], title=entities.find(e=>leafType(e.type||"")==="source_document_title");
 return {confidence:best?.confidence,title:title?String(rawValue(title)??""):undefined};
}
export class GoogleDocumentAIAcquisitionProvider implements MachineAcquisitionProvider {
 readonly providerName="GOOGLE_DOCUMENT_AI";
 constructor(private readonly config:GoogleDocumentAIProviderConfig){}
 async process(request:MachineAcquisitionRequest):Promise<TESMachineDocumentResult>{
  const {projectId,location,processorId,processorVersion,accessToken}=this.config;
  const processorPath=`projects/${projectId}/locations/${location}/processors/${processorId}`;
  const versionPath=processorVersion?`${processorPath}/processorVersions/${processorVersion}`:processorPath;
  const response=await fetch(`https://${location}-documentai.googleapis.com/v1/${versionPath}:process`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({rawDocument:{content:request.contentBase64,mimeType:request.mimeType}})});
  if(!response.ok){const detail=await response.text();throw new Error(`Google Document AI processing failed (${response.status}): ${detail.slice(0,1000)}`)}
  const result=await response.json() as GoogleProcessDocumentResponse, entities=result.document?.entities||[], observations=entities.flatMap(e=>flattenEntity(e)), detected=findRoadsideClassification(entities), classification=classifyRoadsideForRouting(detected.confidence,detected.title), warnings:string[]=[];
  if(!entities.length)warnings.push("Google Document AI returned no schema entities."); if(!observations.length)warnings.push("No Google entities mapped to TES Roadside source data points.");
  return {sourceEvidenceId:request.evidenceId,classification,observations,providerMetadata:{provider:this.providerName,processor:processorId,processorVersion,processedAt:new Date().toISOString()},warnings};
 }
}

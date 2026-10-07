export interface GraphNode {
  id: string;
  type: string;
  payload: any;
  next_node: string | null;
  position?: {
    x: number;
    y: number;
  };
}

export interface BotGraph {
  flow_id?: string;
  start_node: string;
  nodes: GraphNode[];
}

export interface GraphState {
  nodeId: string | null;
  waiting: boolean;
  variables: Record<string, string>;
  activeMenus?: string[];
}

export interface GraphInput {
  text?: string;
  selection?: string;
  selectionNodeId?: string;
  fieldType?: string;
}

export interface GraphResult {
  state: GraphState;
  messages: any[];
  resetSelections?: boolean;
  delay?: {
    seconds: number;
    nextNodeId: string;
  };
  assignment?: {
    nodeId: string;
    userUid: string;
  };
}

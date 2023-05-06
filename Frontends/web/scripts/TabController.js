
const ADD_EDGE = "addEdge"
const ADD_NODE = "addNode"
const REMOVE_EDGE = "removeEdge"
const REMOVE_NODE = "removeNode"
const CHANGE_EDGE_LABEL = "changeEdgeLabel"
const MARKER = "marker"

const HISTORY_MARKER = { type: MARKER, data: {} }

let globalCounter = 0

class TabController {
    constructor() {
        this.view = null
        this.nodes = new vis.DataSet([])
        this.edges = new vis.DataSet([])
        this.undoHistory = []
        this.redoHistory = []
        this.idCounter = 1
        this.selectedNode = null
        this.container = null
        this.zoom = null
        this.mermaidId = "mermaidStuff" + (globalCounter++)
    }

    initView(view) {
        this.view = view

        if (typeof customElements.get("diagram-div") === "undefined") {
            customElements.define("diagram-div", MermaidDiv)
        }

        // add layout
        const wrapperLayout = htmlToElement('<div class="content"><div class="graph"></div></div>')
        this.view.appendChild(wrapperLayout)

        // init layout
        const container = wrapperLayout.querySelector(".graph")
        this.container = container

        const _this = this
        container.addEventListener('click', (element) => {
            _this.selectNode(null)
        })
        this.zoom = panzoom(this.container, {
            smoothScroll: false
        })
        this.draw()
    }

    deinitView(view) {
        // do nothing
    }

    export() {
        return JSON.stringify([this.idCounter, this.nodes.get(), this.edges.get()])
    }

    import(data) {
        const [id, nodes, edges] = JSON.parse(data)

        this.reset()
        this.nodes = new vis.DataSet(nodes)
        this.edges = new vis.DataSet(edges)
        this.idCounter = id
        this.draw()
    }

    resetScrolling() {
        this.zoom.moveTo(0, 0)
        this.zoom.zoomAbs(0, 0, 1)
    }

    toMermaid(gui = false) {
        const [_, nodes, edges] = [this.idCounter, this.nodes.get(), this.edges.get()]

        if (nodes.length == 0) {
            return ""
        }

        // to support older clients, we switch from flowchart to graph for export
        let s = gui ? "flowchart TD\n" : "graph TD\n"

        for (const node of nodes) {
            s += `  N${node.id}["${escapeHtml(node.label, gui)}"]\n`
        }
        s += "\n\n"
        for (const edge of edges) {
            if ('label' in edge) {
                s += `N${edge.from}-->|"${escapeHtml(edge.label, gui)}"|N${edge.to}\n`
            } else {
                s += `N${edge.from} --> N${edge.to}\n`
            }
        }

        if (gui) {
            s += "\n\n"
            if (this.selectedNode != null) {
                s += `style N${this.selectedNode.id} fill:#b9b9ff,stroke:#333,stroke-width:4px`
            }
        }
        return s
    }

    onClick(target, elementId) {
        this.selectNode(elementId)
    }

    onRightClick(target, elementId) {
        const node = this.nodes.get(elementId)
        if ('address' in node.extra && 'networkController' in window) {
            window.networkController.send(JSON.stringify({
                version: 2,
                address: node.extra.address,
                project: node.extra.project
            }))
        }
    }

    #setLabelForEdge(edge, value) {
        if (value) {
            edge.label = value
        } else {
            delete edge.label
        }
    }

    onEdgeDblClick(src, dst) {
        const _this = this
        const edge = this.edges.get({ filter: item => item.from == src && item.to == dst })[0]
        const edgeOldLabel = edge.label

        setTimeout(function () {
            Swal.fire({
                title: 'Edge\'s text',
                input: 'text',
                inputValue: edge.label || "",
                showCancelButton: true,
                showDenyButton: true,
                denyButtonText: `Delete the edge`,
            }).then(result => {
                if (result.isConfirmed) {
                    const {value} = result
                    if (value != null) {
                        _this.#setLabelForEdge(edge, value)

                        // update history
                        _this.redoHistory = []
                        _this.addUndoMarker()
                        _this.undoHistory.push({ type: CHANGE_EDGE_LABEL, data: { id: edge.id, oldLabel: edgeOldLabel, newLabel: value } })

                        _this.draw()
                    }
                } else if (result.isDenied) {
                    _this.edges.remove(edge.id)

                    // update history
                    _this.redoHistory = []
                    _this.addUndoMarker()
                    _this.undoHistory.push({ type: REMOVE_EDGE, data: { ...edge } })

                    _this.draw()
                }
            })
        })
    }

    draw() {
        setTimeout(() => {
            if ('tabsController' in window) {
                window.tabsController.save()
            }
        })

        const _this = this

        const data = this.toMermaid(true)
        if (data.length == 0) {
            this.container.textContent = "empty graph"
            return
        }

        this.container.textContent = data
        this.container.removeAttribute('data-processed');

        mermaid.render(this.mermaidId, data).then(({ svg, bindFunctions }) => {
            const el = document.createElement("div")
            el.innerHTML = svg
            const shadow = document.createElement("diagram-div")
            shadow.shadowRoot.appendChild(el)
            replaceChildren(_this.container, [shadow])
        }).then(() => {
        // hacks to add listeners
            const nodesArray = [..._this.container.getElementsByTagName('diagram-div')[0].shadowRoot.querySelectorAll('.node')]
            for (const node of nodesArray) {
                // fix pointer
                node.classList.add("clickable")
                // add click event
                if (!node.hasAttribute("has_listeners")) {
                    node.setAttribute("has_listeners", "true")
                    node.addEventListener('click', (event) => {
                        _this.onClick(event.currentTarget, parseInt(event.currentTarget.id.split('-')[1].substring(1)))
                        event.preventDefault()
                        event.stopPropagation()
                    })
                    // add right click event
                    node.addEventListener('contextmenu', (event) => {
                        _this.onRightClick(event.currentTarget, parseInt(event.currentTarget.id.split('-')[1].substring(1)))
                        event.preventDefault()
                        event.stopPropagation()
                    })
                }
            }

            const edgesArray = [..._this.container.getElementsByTagName('diagram-div')[0].shadowRoot.querySelectorAll('.edge-thickness-normal')]
            for (const edge of edgesArray) {
                // fix pointer
                edge.style.cursor = "pointer"
                // add click event
                if (!edge.hasAttribute("has_listeners")) {
                    edge.setAttribute("has_listeners", "true")
                    edge.addEventListener('dblclick', (event) => {
                        const classes = [...edge.classList]
                        const src = parseInt(classes.filter(it => it.startsWith('LS-N'))[0].substring(4))
                        const dst = parseInt(classes.filter(it => it.startsWith('LE-N'))[0].substring(4))
                        _this.onEdgeDblClick(src, dst)
                        event.preventDefault()
                        event.stopPropagation()
                    })
                }
            }
        })
    }

    reset(shouldSupportUndo = false) {
        if (shouldSupportUndo) {
            // Add all node and edges to undo
            this.addUndoMarker()
            this.undoHistory.push(...this.nodes.map((node) => ({ type: REMOVE_NODE, data: { ...node } })))
            this.undoHistory.push(...this.edges.map((edge) => ({ type: REMOVE_EDGE, data: { ...edge } })))
        } else {
            this.undoHistory = []
        }

        this.redoHistory = []
        this.edges.clear()
        this.nodes.clear()

        this.selectedNode = null

        this.draw()
    }

    addNode(node, design = null) {
        updateNodeProperties(node)

        // TODO make design customizable
        const _design = design || {}
        // create the vis node
        const visNode = {
            id: this.idCounter++,
            label: node.label,
            extra: node,
            ..._design
        }

        // add to the network
        this.nodes.add(visNode)

        // update history
        this.redoHistory = []
        this.undoHistory.push({ type: ADD_NODE, data: { ...visNode } })

        this.draw()

        return visNode
    }

    addEdge(edge, design = null) {
        updateNodeProperties(edge)

        // TODO make design customizable
        const _design = design || {}

        // create the vis edge
        const visEdge = {
            id: this.idCounter++,
            from: edge.from,
            to: edge.to,
            ..._design
        }

        if ('label' in edge) {
            visEdge.label = edge.label
        }

        // add to the network
        this.edges.add(visEdge)

        // update history
        this.redoHistory = []
        this.undoHistory.push({ type: ADD_EDGE, data: { ...visEdge } })

        this.draw()

        return visEdge
    }

    queryNode(propertyName, propertyValue) {
        const result = this.nodes.get({
            filter: function (item) {
                return item.extra[propertyName] == propertyValue;
            }
        });
        if (result.length == 1) {
            return result[0]
        }
        return null;
    }

    selectNode(id) {
        if (id == null) {
            this.selectedNode = null
        } else {
            this.selectedNode = this.nodes.get(id)
        }
        this.draw()
    }

    addUndoMarker() {
        this.undoHistory.push(HISTORY_MARKER)
    }

    undo() {
        if (this.undoHistory.length) {
            this.redoHistory.push(HISTORY_MARKER)
            while (this.undoHistory.length) {
                const historyEntry = this.undoHistory.pop()
                const { type, data } = historyEntry
                if (type == MARKER) {
                    break
                } else if (type == ADD_NODE) {
                    this.nodes.remove(data.id)
                } else if (type == ADD_EDGE) {
                    this.edges.remove(data.id)
                } else if (type == REMOVE_NODE) {
                    this.nodes.add(data)
                } else if (type == REMOVE_EDGE) {
                    this.edges.add(data)
                } else if (type == CHANGE_EDGE_LABEL) {
                    const { id, oldLabel } = data
                    const edge = this.edges.get(id)
                    this.#setLabelForEdge(edge, oldLabel)
                }



                this.redoHistory.push(historyEntry)

            }

            if (this.selectedNode != null && this.nodes.get(this.selectedNode.id) == null) {
                this.selectedNode = null
            }

            this.draw()
        }
    }

    redo() {
        if (this.redoHistory.length) {
            this.undoHistory.push(HISTORY_MARKER)
            while (this.redoHistory.length) {
                const historyEntry = this.redoHistory.pop()
                const { type, data } = historyEntry
                if (type == MARKER) {
                    break
                } else if (type == ADD_NODE) {
                    this.nodes.add(data)
                } else if (type == ADD_EDGE) {
                    this.edges.add(data)
                } else if (type == REMOVE_NODE) {
                    this.nodes.remove(data.id)
                } else if (type == REMOVE_EDGE) {
                    this.edges.remove(data.id)
                } else if (type == CHANGE_EDGE_LABEL) {
                    const { id, newLabel } = data
                    const edge = this.edges.get(id)
                    this.#setLabelForEdge(edge, newLabel)
                }
                this.undoHistory.push(historyEntry)
            }

            if (this.selectedNode != null && this.nodes.get(this.selectedNode.id) == null) {
                this.selectedNode = null
            }

            this.draw()
        }
    }

    deleteCurrentNode() {
        if (this.selectedNode) {
            const removedNode = this.selectedNode
            const removedNodeId = removedNode.id
            // Start undo session
            this.addUndoMarker()
            // Remove the node
            this.nodes.remove(removedNode.id)
            // Update undo history for node
            this.undoHistory.push({ type: REMOVE_NODE, data: { ...removedNode } })
            // Get all edges containing the node
            const removedEdges = this.edges.get({
                filter: (edge) => edge.from == removedNodeId ||
                    edge.to == removedNodeId
            })
            // Remove them, and update undo history
            for (const removedEdge of removedEdges) {
                this.edges.remove(removedEdge.id)
                this.undoHistory.push({ type: REMOVE_EDGE, data: { ...removedEdge } })
            }

            // update history
            this.redoHistory = []

            // remember to clear selected node
            this.selectedNode = null

            this.draw()
        }
    }

    updateNodes(selection, updateObj) {
        const updates = this.nodes.get({
            filter: item => {
                const extra = item.extra
                for (const [key, value] of selection) {
                    if (!(key in extra)) return false;
                    if (extra[key] != value) return false;
                }
                return true;
            }

        }).map(item => mergeToVisNode(item, updateObj))
        this.nodes.updateOnly(updates)

        const updateUndoItem = item => {
            if (item.type != ADD_NODE && item.type != REMOVE_NODE)
                return item

            const extra = item.data.extra
            for (const [key, value] of selection) {
                if (!(key in extra)) return item;
                if (extra[key] != value) return item;
            }
            return ({ type: item.type, data: mergeToVisNode(item.data, updateObj) })
        }

        this.undoHistory = this.undoHistory.map(updateUndoItem)
        this.redoHistory = this.redoHistory.map(updateUndoItem)


        this.draw()
    }

    getProjects() {
        return new Set(this.nodes.map(it => ('project' in it.extra) ? it.extra.project : null).filter(it => it != null));
    }
}

const NODE_COMPUTED_PROPERTIES = "computedProperties"

/** Compute the computed properties, and update the given node */
function updateNodeProperties(node) {
    if (NODE_COMPUTED_PROPERTIES in node) {
        for (const { name, format, replacements } of node[NODE_COMPUTED_PROPERTIES]) {
            const realReplacements = replacements.map(fieldName => node[fieldName])
            node[name] = formatString(format, realReplacements)
        }
    }
}

function mergeToVisNode(visNode, updateObj) {
    const newNodeExtra = { ...visNode.extra, ...updateObj }
    updateNodeProperties(newNodeExtra)
    return { ...visNode, id: visNode.id, label: newNodeExtra.label, extra: newNodeExtra }
}

function createFromTo(currentNode, newNode, isExistingToNew) {
    if (isExistingToNew)
        return { from: currentNode, to: newNode }
    else
        return { from: newNode, to: currentNode }
}

function formatString(s, replacements) {
    let str = s;
    if (replacements.length) {
        for (const key in replacements) {
            str = str.replace(new RegExp("\\{" + key + "\\}", "gi"), replacements[key]);
        }
    }
    return str;
}

function escapeHtml(unsafe, gui) {
    const res = unsafe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    return gui ? res : res.replace('\n', '')
}

/**
 * @param {String} HTML representing a single element
 * @return {Element}
 */
function htmlToElement(html) {
    var template = document.createElement('template');
    html = html.trim(); // Never return a text node of whitespace as the result
    template.innerHTML = html;
    return template.content.firstChild;
}

function replaceChildren(el, nodes) {
    if (el.replaceChildren)
        return el.replaceChildren(...nodes); // supported Chrome 86+

    el.innerHTML = "";
    el.append(...nodes);
}

class MermaidDiv extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: "open" })
    }
}
async function seedTopology(pool) {
  // Check if topology_nodes has data
  const [countRes] = await pool.query('SELECT COUNT(*) as c FROM topology_nodes');
  if (countRes[0].c > 0) return; // Already seeded

  console.log('[DB] Seeding topology_nodes...');

  let nodeCounter = 1;
  const nodesToInsert = [];

  const RAW_LOCATIONS = [
    ['GUDANG IT','1'],['QC LAB','2'],['R&D PES','2'],['OFFICE LAB','2'],
    ['MUSHOLLA','2'],['KANTOR BARU LT 2','3'],['KANTOR BARU LT 1','3'],
    ['GEDUNG A1','4'],['GEDUNG A2','4'],['GEDUNG B1 - OFFICE GUDANG RMT C12','4'],
    ['GEDUNG B3 - OFFICE MTC LT. 1','4'],['GEDUNG B3 - MTC LT. 2','4'],
    ['GEDUNG B1 - PROD CF','4'],['GEDUNG B5 - MP','4'],['GEDUNG J','4'],
    ['GEDUNG F3','4'],['MESS DALAM KABAG','4'],['GEDUNG F4','4'],
    ['GEDUNG I3','4'],['GEDUNG E3 - OFFICE REAKTOR','4'],['MESIN','4'],
    ['GUDANG BOTOL','4'],['GEDUNG D2 - OFFICE BOTOL','4'],
    ['GEDUNG D1 - PROD BOTOL','4'],['GEDUNG E3','4'],['KANTIN ATAS','4'],
    ['KANTOR GUDANG MULSA','4'],['ATAS TANGGAL OFFICE MULSA','4'],
    ['GERBANG PRODUKSI MULSA','4'],['POS SECURITY MULSA','4'],
    ['PRIMAXON','5'],['KANTOR R&D PLS','5']
  ];
  const SEED_LOCATIONS = RAW_LOCATIONS.map((r,i)=>({id:'l'+(i+1), nama:r[0]}));
  function findLocId(name){
    const l = SEED_LOCATIONS.find(x=>x.nama===name);
    return l ? l.id : null;
  }

  function B(label, locName, children){ return {kind:'building', label, locId: findLocId(locName), children: children||[]}; }
  function N(label, children, extra){ return Object.assign({kind:'infra', label, children: children||[]}, extra||{}); }

  const MIKROTIK_CBA = N('Mikrotik CBA', [
    N('Fortigate', [
      N('Switch MG HP Aruba', [
        N('Switch VLAN 2 CCTV', []),
        N('Lantai 1 Lab', [ B('QC Lab','QC LAB',[]), B('R&D PES','R&D PES',[]) ]),
        N('Lantai 2 Lab', [ B('Office Lab','OFFICE LAB',[]), B('Musholla','MUSHOLLA',[]) ]),
        N('Link FO Kantor Baru (202m)', [
          N('Convert FO to LAN', [
            N('Switch MG Distribusi', [
              N('Switch MG A', [ B('Kantor Baru LT 2','KANTOR BARU LT 2',[]) ]),
              N('Switch MG B', [ B('Kantor Baru LT 2','KANTOR BARU LT 2',[]) ]),
              N('Switch MG C', [ B('Kantor Baru LT 1','KANTOR BARU LT 1',[]) ]),
              N('Switch MG D', [ B('Kantor Baru LT 1','KANTOR BARU LT 1',[]) ]),
              N('Convert LAN to FO', [
                N('RM Gedung A3', [
                  B('Gedung A1','GEDUNG A1',[]), B('Gedung A2','GEDUNG A2',[]),
                  B('Gudang RMT C12','GEDUNG B1 - OFFICE GUDANG RMT C12',[]),
                  B('Office MTC Lt. 1','GEDUNG B3 - OFFICE MTC LT. 1',[]),
                  B('MTC Lt. 2','GEDUNG B3 - MTC LT. 2',[])
                ]),
                N('RM Kantor CF B2', [ B('Kantor CF B2','GEDUNG B1 - PROD CF',[]) ]),
                N('RM MP Baru B4',   [ B('MP Baru B4','GEDUNG B5 - MP',[]) ]),
                N('RM Gudang F5', [
                  B('Gedung J','GEDUNG J',[]), B('Gedung F3','GEDUNG F3',[]),
                  B('Mess Kabag','MESS DALAM KABAG',[])
                ]),
                N('RM Kantor F1', [ B('Gedung F4','GEDUNG F4',[]) ]),
                N('RM Gedung H2 Assembling', [ B('Gedung I3','GEDUNG I3',[]) ]),
                N('RM Kantor Methyl', [
                  B('Kantor Reaktor','GEDUNG E3 - OFFICE REAKTOR',[]),
                  B('Mesin','MESIN',[])
                ]),
                N('RM Mini Lab D5', [
                  B('Gudang Botol','GUDANG BOTOL',[]),
                  B('Officer D2','GEDUNG D2 - OFFICE BOTOL',[]),
                  B('Gedung D1','GEDUNG D1 - PROD BOTOL',[])
                ]),
                N('RM Kantor Filling', [
                  B('Gedung E3','GEDUNG E3',[]), B('Kantin Atas','KANTIN ATAS',[])
                ]),
                N('RM Kantor Mulsa', [
                  B('Kantor Gudang Mulsa','KANTOR GUDANG MULSA',[]),
                  B('Atas Tanggal Office Mulsa','ATAS TANGGAL OFFICE MULSA',[]),
                  N('SW MG Gerbang Prod Mulsa', [ B('Gerbang Produksi Mulsa','GERBANG PRODUKSI MULSA',[]) ]),
                  N('SW MG Pos Security',       [ B('Pos Security Mulsa','POS SECURITY MULSA',[]) ])
                ])
              ])
            ])
          ])
        ])
      ]),
      B('Primaxon','PRIMAXON',[]),
      B('Kantor R&D PLS','KANTOR R&D PLS',[])
    ])
  ], {id:'mikrotik_cba', extraParents:['mikrotik_maxindo']});

  const NETWORK_TREE = B('GUDANG IT', 'GUDANG IT', [
    N('Fiber Optik STP', [
      N('ODP Fiber Optik STP', [ N('Mikrotik STP', [ MIKROTIK_CBA ]) ])
    ]),
    N('Fiber Optik Maxindo', [
      N('ODP Fiber Optik Maxindo', [
        N('Router FO Telkom / Radio Wireless FR BSM', [
          N('Mikrotik Maxindo', [], {id:'mikrotik_maxindo'})
        ])
      ])
    ])
  ]);

  function processNode(node, parentId = null, orderIdx = 0) {
    const id = node.id || ('node_' + nodeCounter++);
    nodesToInsert.push({
      id: id,
      label: node.label,
      kind: node.kind,
      loc_id: node.locId || null,
      parent_id: parentId,
      extra_parents: node.extraParents || null,
      order_idx: orderIdx
    });
    if (node.children) {
      node.children.forEach((child, idx) => processNode(child, id, idx));
    }
  }

  processNode(NETWORK_TREE);

  for (const n of nodesToInsert) {
    await pool.query(
      'INSERT INTO topology_nodes (id, label, kind, loc_id, parent_id, extra_parents, order_idx) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [n.id, n.label, n.kind, n.loc_id, n.parent_id, n.extra_parents ? JSON.stringify(n.extra_parents) : null, n.order_idx]
    );
  }
  console.log('[DB] topology_nodes successfully seeded.');
}

module.exports = seedTopology;

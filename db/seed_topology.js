async function seedTopology(pool) {
  // Check if topology_nodes has data
  const [countRes] = await pool.query('SELECT COUNT(*) as c FROM topology_nodes');
  if (countRes[0].c > 0) return; // Already seeded

  console.log('[DB] Seeding topology_nodes...');

  let nodeCounter = 1;
  const nodesToInsert = [];

  const RAW_LOCATIONS = [
    ['LAB SPRAYER','PRODUKSI'],['RUANG UKK','PRODUKSI'],['RUANG ATK','PRODUKSI'],['RUANG BENIH','PRODUKSI'],
    ['LAB LT. 1','PRODUKSI'],['LAB LT. 2','PRODUKSI'],['KANTOR PRODUKSI LT. 1','PRODUKSI'],['KANTOR PRODUKSI LT. 2','PRODUKSI'],
    ['GEDUNG A1','A'],['GEDUNG A2','A'],['GEDUNG A3','A'],['GEDUNG A3 - OFFICE','A'],
    ['GEDUNG B1 - PROD CF','B'],['GEDUNG B1 - OFFICE GUDANG RMT C12','B'],['GEDUNG B2','B'],['GEDUNG B3 - OFFICE MTC LT. 1','B'],
    ['GEDUNG B3 - MTC LT. 2','B'],['GEDUNG B4 - IF','B'],['GEDUNG B4 - IF OFFICE','B'],['GEDUNG B5 - MP','B'],
    ['GEDUNG C1 - GUDANG RMT MLS','C'],['GEDUNG C2 - PROD MLS','C'],['GEDUNG C2 - OFFICE MLS','C'],
    ['GEDUNG D1 - PROD BOTOL','D'],['GEDUNG D2 - PROD BOTOL','D'],['GEDUNG D2 - OFFICE BOTOL','D'],['GEDUNG D3','D'],
    ['GEDUNG D3 - OFFICE GUDANG RMT BTL','D'],['GEDUNG D4','D'],['GEDUNG D5 - MINI LAB','D'],
    ['GEDUNG E1','E'],['GEDUNG E1 - OFFICE','E'],['GEDUNG E2','E'],['GEDUNG E3','E'],['GEDUNG E3 - OFFICE REAKTOR','E'],
    ['GEDUNG E4','E'],['GEDUNG E5','E'],['GEDUNG E5 - OFFICE PRODUKSI MT','E'],
    ['GEDUNG F1','F'],['GEDUNG F1 - OFFICE GDG RMT','F'],['GEDUNG F2','F'],['GEDUNG F2 - OFFICE GDG RMT','F'],
    ['GEDUNG F3','F'],['GEDUNG F3 - OFFICE GDG RMT','F'],['GEDUNG F4','F'],['GEDUNG F4 - OFFICE PROD FL','F'],
    ['GEDUNG F5','F'],['GEDUNG F5 - OFFICE','F'],
    ['GEDUNG G1','G'],['GEDUNG G2','G'],
    ['GEDUNG H1','H'],['GEDUNG H2','H'],['GEDUNG H2 - OFFICE','H'],['GEDUNG H3','H'],
    ['GEDUNG I1','I'],['GEDUNG I2','I'],['GEDUNG I3','I'],['GEDUNG I3 - OFFICE GDG RMT','I'],['GEDUNG I4','I'],['GEDUNG I5','I'],
    ['GEDUNG J','J'],['GEDUNG J - OFFICE','J'],
    ['POS SECURITY','SECURITY'],
    ['MESS DALAM KABAG','MESS'],['MESS LAES - LAJANG','MESS'],['MESS LAES - KELUARGA','MESS'],
    ['MESS CIKANDE - DEPAN','MESS'],['MESS CIKANDE - BELAKANG','MESS'],
    ['GUDANG RMT LEGOK','GUDANG_EKS'],['GUDANG RMT CEMPLANG','GUDANG_EKS'],
    ['GUDANG IT','INTI'],['KANTOR BARU LT 1','INTI'],['KANTOR BARU LT 2','INTI'],
    ['QC LAB','GUDANG_IT_AREA'],['R&D PES','GUDANG_IT_AREA'],['OFFICE LAB','GUDANG_IT_AREA'],
    ['MUSHOLLA','GUDANG_IT_AREA'],['PRIMAXON','GUDANG_IT_AREA'],['KANTOR R&D PLS','GUDANG_IT_AREA'],
    ['MESIN','E'],['GUDANG BOTOL','D'],['KANTIN ATAS','E'],
    ['KANTOR GUDANG MULSA','MULSA'],['ATAS TANGGAL OFFICE MULSA','MULSA'],
    ['GERBANG PRODUKSI MULSA','MULSA'],['POS SECURITY MULSA','MULSA']
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

async function confirmModelDownload(model, source = 'Hugging Face') {
  const { dialog } = require('electron');
  const { response } = await dialog.showMessageBox({
    type: 'question', title: 'Download this model',
    message: `Download ${model}?`,
    detail: `This optional model and its required files will be downloaded from ${source}. Downloads may require several GB of disk space. The model will be saved on this computer for future use.`,
    buttons: ['Download this model', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
  });
  return response === 0;
}
module.exports = { confirmModelDownload };
